/**
 * Route calculation, marker management, and pricing.
 */
import L from 'leaflet';
import { pinIcon } from '../utils/map.js';
import { toggleSheet, isSheetMinimized, showStatus } from './ui.js';

// Tarifas Moto
const BASE_FARE    = 2500;
const PER_KM_FARE  = 1000;
const PER_MIN_FARE = 120;
const MIN_FARE     = 3500;

function haversineKm(a, b) {
  const R    = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const x    = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function showPrice(distKm, mins) {
  const km = parseFloat(distKm) || 0;
  let price = BASE_FARE + (km * PER_KM_FARE) + (mins * PER_MIN_FARE);
  price = Math.round(price / 100) * 100;
  price = Math.max(MIN_FARE, price);
  const el = document.getElementById('priceValue');
  if (el) el.textContent = '$' + price.toLocaleString('es-CO');
  return price;
}

/**
 * Obtiene las coordenadas de la ruta real por calles.
 * Intenta Valhalla primero, luego OSRM como respaldo.
 * Devuelve { distKm, mins, coords: [[lat,lng],...] } o null.
 */
async function fetchRouteLine(slng, slat, elng, elat) {
  // ── Intento 1: Valhalla (routing engine diferente a OSRM, más estable) ──
  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch('https://valhalla1.openstreetmap.de/route', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        locations:    [{ lon: slng, lat: slat }, { lon: elng, lat: elat }],
        costing:      'auto',
        shape_format: 'geojson'
      }),
      signal: ctrl.signal
    });
    const data = await res.json();
    const leg  = data?.trip?.legs?.[0];
    if (leg?.shape?.coordinates?.length) {
      return {
        distKm: leg.summary.length,
        mins:   Math.round(leg.summary.time / 60) || 1,
        coords: leg.shape.coordinates.map(([lng, lat]) => [lat, lng])
      };
    }
  } catch (_) { /* Valhalla falló, probar OSRM */ }

  // ── Intento 2: OSRM ──
  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 10000);
    const url  = `https://router.project-osrm.org/route/v1/driving/${slng},${slat};${elng},${elat}?overview=full&geometries=geojson`;
    const res  = await fetch(url, { signal: ctrl.signal });
    const data = await res.json();
    if (data.code === 'Ok' && data.routes?.[0]) {
      const route = data.routes[0];
      return {
        distKm: route.legs[0].distance / 1000,
        mins:   Math.round(route.legs[0].duration / 60) || 1,
        coords: route.geometry.coordinates.map(([lng, lat]) => [lat, lng])
      };
    }
  } catch (_) { /* OSRM también falló */ }

  return null;
}

const iconStart = pinIcon('#30D158', 'A');
const iconEnd   = pinIcon('#FF6B00', 'B');

export function placeMarker(type, lat, lng, name, state, map) {
  const ll = L.latLng(lat, lng);
  if (type === 'start') {
    if (state.startMarker) map.removeLayer(state.startMarker);
    state.startLatLng = ll;
    state.startMarker = L.marker(ll, { icon: iconStart }).addTo(map)
      .bindPopup(`<b>🟢 Inicio</b><br>${name}`);
  } else {
    if (state.endMarker) map.removeLayer(state.endMarker);
    state.endLatLng = ll;
    state.endMarker = L.marker(ll, { icon: iconEnd }).addTo(map)
      .bindPopup(`<b>🟠 Destino</b><br>${name}`);
  }
  map.panTo(ll);
  checkRoute(state, map);
}

export function clearPoint(type, state, map) {
  if (type === 'start') {
    if (state.startMarker) { map.removeLayer(state.startMarker); state.startMarker = null; }
    state.startLatLng = null;
    const el = document.getElementById('startInput');
    if (el) el.value = '';
  } else {
    if (state.endMarker) { map.removeLayer(state.endMarker); state.endMarker = null; }
    state.endLatLng = null;
    const el = document.getElementById('endInput');
    if (el) el.value = '';
  }

  if (state.routeLine)    { map.removeLayer(state.routeLine);    state.routeLine    = null; }
  if (state.fallbackLine) { map.removeLayer(state.fallbackLine); state.fallbackLine = null; }

  const pill = document.getElementById('routePill');
  if (pill) pill.style.display = 'none';

  const actions  = document.getElementById('mainActions');
  const priceSec = document.getElementById('priceSection');
  if (actions) {
    actions.style.display = 'flex';
    actions.innerHTML = '<button class="btn" style="background:rgba(255,255,255,.05);color:rgba(255,255,255,.3);width:100%" disabled>📍 Selecciona los puntos del viaje</button>';
  }
  if (priceSec) priceSec.style.display = 'none';
  showStatus('', false);

  if (state.pollerInterval) { clearInterval(state.pollerInterval); state.pollerInterval = null; }
}

export function checkRoute(state, map) {
  if (!(state.startLatLng && state.endLatLng)) return;

  // Limpiar líneas previas
  if (state.routeLine)    { map.removeLayer(state.routeLine);    state.routeLine    = null; }
  if (state.fallbackLine) { map.removeLayer(state.fallbackLine); state.fallbackLine = null; }

  // ── 1. Precio y UI instantáneos con Haversine ──
  const quickKm   = haversineKm(state.startLatLng, state.endLatLng) * 1.3;
  const quickMins = Math.round((quickKm / 22) * 60) || 1;

  const distEl = document.getElementById('routeDistance');
  const timeEl = document.getElementById('routeTime');
  const pillEl = document.getElementById('routePill');
  if (distEl) distEl.textContent = quickKm.toFixed(1);
  if (timeEl) timeEl.textContent = quickMins;
  if (pillEl) pillEl.style.display = 'flex';

  showPrice(quickKm.toFixed(1), quickMins);
  document.getElementById('mainActions').style.display  = 'none';
  document.getElementById('priceSection').style.display = 'block';
  if (isSheetMinimized()) toggleSheet();

  // Capturar referencias por si los puntos cambian mientras el fetch corre
  const startSnap = state.startLatLng;
  const endSnap   = state.endLatLng;

  // ── 2. Obtener ruta real por calles (Valhalla → OSRM) ──
  const { lat: slat, lng: slng } = startSnap;
  const { lat: elat, lng: elng } = endSnap;

  fetchRouteLine(slng, slat, elng, elat).then(result => {
    // Ignorar si los puntos cambiaron mientras esperábamos
    if (state.startLatLng !== startSnap || state.endLatLng !== endSnap) return;

    if (!result) {
      // Sin resultado: ajustar mapa y listo (precio Haversine ya está visible)
      map.fitBounds(L.latLngBounds([startSnap, endSnap]).pad(0.3));
      return;
    }

    // Dibujar línea naranja siguiendo las calles
    state.routeLine = L.polyline(result.coords, {
      color:   '#FF6B00',
      weight:  8,
      opacity: 0.85
    }).addTo(map);

    // Actualizar km/min/precio con valores exactos
    if (distEl) distEl.textContent = result.distKm.toFixed(1);
    if (timeEl) timeEl.textContent = result.mins;
    showPrice(result.distKm.toFixed(1), result.mins);
    showStatus('', false);

    map.fitBounds(state.routeLine.getBounds().pad(0.3));
  });
}
