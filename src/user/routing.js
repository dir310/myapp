/**
 * Route calculation, marker management, and pricing.
 */
import L from 'leaflet';
import { pinIcon } from '../utils/map.js';
import { toggleSheet, isSheetMinimized, showStatus } from './ui.js';

/** Dibuja (o reemplaza) la polilínea naranja en el mapa. */
function drawRouteLine(coords, state, map) {
  if (state.routeLine) { map.removeLayer(state.routeLine); state.routeLine = null; }
  state.routeLine = L.polyline(coords, {
    color:    '#FF6B00',
    weight:   7,
    opacity:  0.9,
    lineCap:  'round',
    lineJoin: 'round',
  }).addTo(map);
}

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

  if (state.routingControl) { map.removeControl(state.routingControl); state.routingControl = null; }
  if (state.routeLine)      { map.removeLayer(state.routeLine);        state.routeLine      = null; }

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

  // Limpiar ruta previa
  if (state.routingControl) { map.removeControl(state.routingControl); state.routingControl = null; }
  if (state.routeLine)      { map.removeLayer(state.routeLine);        state.routeLine = null; }

  // ── 1. Precio instantáneo (Haversine, sin espera) ──
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

  // ── 2. Fetch OSRM → ruta real por calles (sin línea recta previa) ──
  const { lat: sLat, lng: sLng } = state.startLatLng;
  const { lat: eLat, lng: eLng } = state.endLatLng;
  const osrmUrl =
    `https://router.project-osrm.org/route/v1/driving/${sLng},${sLat};${eLng},${eLat}` +
    `?overview=full&geometries=geojson`;

  fetch(osrmUrl)
    .then(r => r.json())
    .then(data => {
      if (!data.routes || data.routes.length === 0) return;

      const route  = data.routes[0];
      const distKm = route.distance / 1000;
      const mins   = Math.round(route.duration / 60) || 1;
      if (distKm < 0.01) return;

      // Actualizar con valores reales de OSRM
      if (distEl) distEl.textContent = distKm.toFixed(1);
      if (timeEl) timeEl.textContent = mins;
      showPrice(distKm.toFixed(1), mins);
      showStatus('', false);

      // Dibujar la ruta real siguiendo las calles
      const coords = data.routes[0].geometry.coordinates.map(([lng, lat]) => [lat, lng]);
      drawRouteLine(coords, state, map);
    })
    .catch(() => {
      showStatus('', false);
    });
}
