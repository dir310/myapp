/**
 * Route calculation, marker management, and pricing.
 * Usa fetch con reintentos automáticos para máxima fiabilidad con el servidor OSRM.
 */
import L from 'leaflet';
import { pinIcon } from '../utils/map.js';
import { toggleSheet, isSheetMinimized, showStatus } from './ui.js';

// Tarifas Moto (Estilo Picap/DiDi)
const BASE_FARE    = 2500;
const PER_KM_FARE  = 1000;
const PER_MIN_FARE = 120;
const MIN_FARE     = 3500;

/** Calcula distancia en km entre dos L.LatLng (fórmula Haversine) */
function haversineKm(a, b) {
  const R    = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const x    = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

/** Calcula y muestra el precio dado distancia (km) y tiempo (min) */
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
 * Llama a OSRM con reintentos automáticos.
 * El servidor a veces devuelve 504 en el primer intento pero responde en el segundo.
 */
async function fetchRoute(slng, slat, elng, elat) {
  const url    = `https://router.project-osrm.org/route/v1/driving/${slng},${slat};${elng},${elat}?overview=full&geometries=geojson`;
  const WAIT   = [500, 1500, 3000]; // ms de espera entre reintentos

  for (let attempt = 0; attempt <= WAIT.length; attempt++) {
    try {
      const ctrl  = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 9000);
      const res   = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.code !== 'Ok' || !data.routes?.length) throw new Error('no-route');

      return data; // éxito
    } catch (e) {
      if (attempt < WAIT.length) {
        // Esperar antes de reintentar
        await new Promise(r => setTimeout(r, WAIT[attempt]));
      }
    }
  }
  return null; // todos los intentos fallaron
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

  // ── 1. PRECIO INSTANTÁNEO con Haversine ──
  const quickKm   = haversineKm(state.startLatLng, state.endLatLng) * 1.3;
  const quickMins = Math.round((quickKm / 22) * 60) || 1;

  const distEl = document.getElementById('routeDistance');
  const timeEl = document.getElementById('routeTime');
  const pillEl = document.getElementById('routePill');
  if (distEl) distEl.textContent = quickKm.toFixed(1);
  if (timeEl) timeEl.textContent = quickMins;
  if (pillEl) pillEl.style.display = 'flex';

  showPrice(quickKm.toFixed(1), quickMins);

  const actionsEl  = document.getElementById('mainActions');
  const priceSecEl = document.getElementById('priceSection');
  if (actionsEl)  actionsEl.style.display  = 'none';
  if (priceSecEl) priceSecEl.style.display = 'block';
  if (isSheetMinimized()) toggleSheet();

  // Guardar referencia del mapa para la coroutina
  const startLL = state.startLatLng;
  const endLL   = state.endLatLng;

  // ── 2. Fetch OSRM con reintentos automáticos para dibujar la vía real ──
  const { lat: slat, lng: slng } = startLL;
  const { lat: elat, lng: elng } = endLL;

  fetchRoute(slng, slat, elng, elat).then(data => {
    // Verificar que los puntos no cambiaron mientras esperábamos
    if (!state.startLatLng || !state.endLatLng) return;
    if (state.startLatLng !== startLL || state.endLatLng !== endLL) return;

    if (!data) {
      // Todos los intentos fallaron: ajustar mapa sin línea
      map.fitBounds(L.latLngBounds([startLL, endLL]).pad(0.3));
      return;
    }

    const route  = data.routes[0];
    const distKm = route.legs[0].distance / 1000;
    const mins   = Math.round(route.legs[0].duration / 60) || 1;

    // Dibujar la línea naranja por las calles
    const latlngs = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
    state.routeLine = L.polyline(latlngs, {
      color:   '#FF6B00',
      weight:  8,
      opacity: 0.85
    }).addTo(map);

    // Actualizar precio con valores exactos de OSRM
    if (distEl) distEl.textContent = distKm.toFixed(1);
    if (timeEl) timeEl.textContent = mins;
    showPrice(distKm.toFixed(1), mins);
    showStatus('', false);

    map.fitBounds(state.routeLine.getBounds().pad(0.3));
  });
}
