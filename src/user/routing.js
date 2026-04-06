/**
 * Route calculation, marker management, and pricing.
 */
import L from 'leaflet';
import { pinIcon } from '../utils/map.js';
import { toggleSheet, isSheetMinimized, showStatus } from './ui.js';

// ── Tarifas Moto ───────────────────────────────────────────────────────────
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

// ── Íconos ─────────────────────────────────────────────────────────────────
const iconStart = pinIcon('#30D158', 'A');
const iconEnd   = pinIcon('#FF6B00', 'B');

// ── Marcadores ─────────────────────────────────────────────────────────────
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

// ── Limpiar punto ──────────────────────────────────────────────────────────
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

  if (state.routeLine) { map.removeLayer(state.routeLine); state.routeLine = null; }

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
}

// ── Dibujar polilínea (Naranja con borde oscuro) ──────────────────────────
function renderRouteOnMap(coords, state, map, isFallback = false) {
  if (state.routeLine) {
    map.removeLayer(state.routeLine);
    state.routeLine = null;
  }

  const weight = isFallback ? 8 : 10;
  const dashArray = isFallback ? '10, 10' : null;
  const opacity = isFallback ? 0.6 : 1;

  state.routeLine = L.featureGroup([
    L.polyline(coords, { color: '#000', weight: weight + 5, opacity: 0.3, lineCap: 'round' }),
    L.polyline(coords, { 
      color: '#FF6B00', 
      weight: weight, 
      opacity: opacity, 
      lineCap: 'round', 
      lineJoin: 'round',
      dashArray: dashArray
    })
  ]).addTo(map);
}

// ── Cálculo de ruta (INMEDIATO -> REAL) ───────────────────────────────────
export function checkRoute(state, map) {
  if (!(state.startLatLng && state.endLatLng)) return;

  // 1. Mostrar Pills y Precio Haversine al instante
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
  
  map.fitBounds(L.latLngBounds([state.startLatLng, state.endLatLng]).pad(0.3));
  if (isSheetMinimized()) toggleSheet();

  // 1.1 Línea recta de respaldo inmediata (mientras carga la real)
  renderRouteOnMap([
    [state.startLatLng.lat, state.startLatLng.lng],
    [state.endLatLng.lat, state.endLatLng.lng]
  ], state, map, true); // true = dashed fallback

  // 2. PEDIR RUTA REAL A OSRM — Intento directo primero (suele tener CORS habilitado)
  const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${state.startLatLng.lng},${state.startLatLng.lat};${state.endLatLng.lng},${state.endLatLng.lat}?overview=full&geometries=geojson`;

  fetch(osrmUrl)
    .then(r => r.json())
    .then(data => {
      if (data.code !== 'Ok' || !data.routes?.length) throw new Error('No route ok');
      
      const route  = data.routes[0];
      const distKm = (route.distance / 1000).toFixed(1);
      const mins   = Math.round(route.duration / 60) || 1;

      if (distEl) distEl.textContent = distKm;
      if (timeEl) timeEl.textContent = mins;
      showPrice(distKm, mins);

      const curvyCoords = route.geometry.coordinates.map(c => [c[1], c[0]]);
      renderRouteOnMap(curvyCoords, state, map, false); 
      console.log('[MovilCal] Ruta por calles cargada exitosamente.');
    })
    .catch(err => {
      console.warn('[MovilCal] Intento directo falló, probando proxy de respaldo...');
      // Fallback a AllOrigins pero formato JSON envuelto (más estable)
      fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(osrmUrl)}`)
        .then(r => r.json())
        .then(wrapped => {
          const data = JSON.parse(wrapped.contents);
          if (data.code !== 'Ok') return;
          const route = data.routes[0];
          const curvyCoords = route.geometry.coordinates.map(c => [c[1], c[0]]);
          renderRouteOnMap(curvyCoords, state, map, false);
          console.log('[MovilCal] Ruta por calles cargada vía backup.');
        })
        .catch(e => console.error('[MovilCal] Error total en ruta:', e));
    });
}
