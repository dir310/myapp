/**
 * Route calculation, marker management, and pricing.
 * Usa fetch() directo a OSRM para máxima fiabilidad.
 */
import L from 'leaflet';
import { pinIcon } from '../utils/map.js';
import { toggleSheet, isSheetMinimized, showStatus } from './ui.js';

// Tarifas Moto (Estilo Picap/DiDi)
const BASE_FARE   = 2500;
const PER_KM_FARE = 1000;
const PER_MIN_FARE = 120;
const MIN_FARE    = 3500;

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

const iconStart = pinIcon('#30D158', 'A');
const iconEnd   = pinIcon('#FF6B00', 'B');

export function placeMarker(type, lat, lng, name, state, map) {
  const ll = L.latLng(lat, lng);

  if (type === 'start') {
    if (state.startMarker) map.removeLayer(state.startMarker);
    state.startLatLng = ll;
    state.startMarker = L.marker(ll, { icon: iconStart })
      .addTo(map)
      .bindPopup(`<b>🟢 Inicio</b><br>${name}`);
  } else {
    if (state.endMarker) map.removeLayer(state.endMarker);
    state.endLatLng = ll;
    state.endMarker = L.marker(ll, { icon: iconEnd })
      .addTo(map)
      .bindPopup(`<b>🟠 Destino</b><br>${name}`);
  }

  map.panTo(ll);
  checkRoute(state, map);
}

export function clearPoint(type, state, map) {
  if (type === 'start') {
    if (state.startMarker) { map.removeLayer(state.startMarker); state.startMarker = null; }
    state.startLatLng = null;
    const input = document.getElementById('startInput');
    if (input) input.value = '';
  } else {
    if (state.endMarker) { map.removeLayer(state.endMarker); state.endMarker = null; }
    state.endLatLng = null;
    const input = document.getElementById('endInput');
    if (input) input.value = '';
  }

  // Limpiar líneas
  if (state.routeLine)    { map.removeLayer(state.routeLine);    state.routeLine    = null; }
  if (state.fallbackLine) { map.removeLayer(state.fallbackLine); state.fallbackLine = null; }
  if (state.routingControl) { map.removeControl(state.routingControl); state.routingControl = null; }

  // Ocultar info de ruta
  const pill = document.getElementById('routePill');
  if (pill) pill.style.display = 'none';

  // Restaurar acciones iniciales
  const actions   = document.getElementById('mainActions');
  const priceSec  = document.getElementById('priceSection');
  if (actions) {
    actions.style.display = 'flex';
    actions.innerHTML = '<button class="btn" style="background:rgba(255,255,255,.05); color:rgba(255,255,255,.3); width:100%" disabled>📍 Selecciona los puntos del viaje</button>';
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
  if (state.routingControl) { map.removeControl(state.routingControl); state.routingControl = null; }

  // ── 1. Precio instantáneo con Haversine ──
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

  // ── 2. Fetch directo a OSRM para dibujar la vía real ──
  const { lat: slat, lng: slng } = state.startLatLng;
  const { lat: elat, lng: elng } = state.endLatLng;
  const url = `https://router.project-osrm.org/route/v1/driving/${slng},${slat};${elng},${elat}?overview=full&geometries=geojson`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000); // 10s timeout

  fetch(url, { signal: controller.signal })
    .then(r => r.json())
    .then(data => {
      clearTimeout(timer);
      if (data.code !== 'Ok' || !data.routes?.length) throw new Error('no route');

      const route  = data.routes[0];
      const distKm = route.legs[0].distance / 1000;
      const mins   = Math.round(route.legs[0].duration / 60) || 1;

      // Dibujar la línea naranja siguiendo las calles
      const coords = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
      state.routeLine = L.polyline(coords, {
        color: '#FF6B00',
        weight: 8,
        opacity: 0.85
      }).addTo(map);

      // Actualizar con valores exactos de OSRM
      if (distEl) distEl.textContent = distKm.toFixed(1);
      if (timeEl) timeEl.textContent = mins;
      showPrice(distKm.toFixed(1), mins);
      showStatus('', false);

      map.fitBounds(state.routeLine.getBounds().pad(0.3));
    })
    .catch(() => {
      clearTimeout(timer);
      // Fallback silencioso: solo ajustar mapa
      map.fitBounds(L.latLngBounds([state.startLatLng, state.endLatLng]).pad(0.3));
    });
}
