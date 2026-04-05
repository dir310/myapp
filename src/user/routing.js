/**
 * Route calculation, marker management, and pricing.
 * Usa fetch() directo a OSRM con dos servidores en paralelo para máxima fiabilidad.
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

/** Llama a un endpoint OSRM y devuelve los datos de ruta o lanza error */
function fetchOSRM(url) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  return fetch(url, { signal: ctrl.signal })
    .then(r => { clearTimeout(timer); return r.json(); })
    .then(data => {
      if (data.code !== 'Ok' || !data.routes?.length) throw new Error('no route');
      return data;
    });
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

  // ── 2. DOS servidores OSRM en paralelo - gana el que responda primero ──
  const { lat: slat, lng: slng } = state.startLatLng;
  const { lat: elat, lng: elng } = state.endLatLng;
  const coords  = `${slng},${slat};${elng},${elat}`;
  const params  = 'overview=full&geometries=geojson';

  const url1 = `https://router.project-osrm.org/route/v1/driving/${coords}?${params}`;
  const url2 = `https://routing.openstreetmap.de/routed-car/route/v1/driving/${coords}?${params}`;

  // Promise.any resuelve con el primer fetch exitoso
  Promise.any([fetchOSRM(url1), fetchOSRM(url2)])
    .then(data => {
      const route  = data.routes[0];
      const distKm = route.legs[0].distance / 1000;
      const mins   = Math.round(route.legs[0].duration / 60) || 1;

      // Dibujar la línea naranja siguiendo las calles
      const latlngs = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
      state.routeLine = L.polyline(latlngs, {
        color:   '#FF6B00',
        weight:  8,
        opacity: 0.85
      }).addTo(map);

      // Actualizar precio con valores exactos
      if (distEl) distEl.textContent = distKm.toFixed(1);
      if (timeEl) timeEl.textContent = mins;
      showPrice(distKm.toFixed(1), mins);
      showStatus('', false);

      map.fitBounds(state.routeLine.getBounds().pad(0.3));
    })
    .catch(() => {
      // Si los DOS servidores fallan, ajustar mapa sin línea
      map.fitBounds(L.latLngBounds([state.startLatLng, state.endLatLng]).pad(0.3));
    });
}
