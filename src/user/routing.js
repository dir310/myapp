/**
 * Route calculation, marker management, and pricing.
 */
import L from 'leaflet';
import 'leaflet-routing-machine';
import { pinIcon } from '../utils/map.js';
import { toggleSheet, isSheetMinimized, showStatus } from './ui.js';
// Tarifas Moto
const BASE_FARE = 1200;
const PER_KM_FARE = 600;
const PER_MIN_FARE = 100;
const MIN_FARE = 3000;

/** Calcula distancia en km entre dos L.LatLng (fórmula Haversine) */
function haversineKm(a, b) {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const x = Math.sin(dLat/2) ** 2 +
    Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) *
    Math.sin(dLng/2) ** 2;
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

const iconStart = pinIcon('#FF6B00', 'A');
const iconEnd = pinIcon('#30D158', 'B');

/**
 * Place a marker on the map for start or end point.
 * @param {string} type - 'start' or 'end'.
 * @param {number} lat - Latitude.
 * @param {number} lng - Longitude.
 * @param {string} name - Display name.
 * @param {object} state - Shared app state.
 * @param {L.Map} map - Leaflet map instance.
 */
export function placeMarker(type, lat, lng, name, state, map) {
  const ll = L.latLng(lat, lng);

  if (type === 'start') {
    if (state.startMarker) map.removeLayer(state.startMarker);
    state.startLatLng = ll;
    state.startMarker = L.marker(ll, { icon: iconStart })
      .addTo(map)
      .bindPopup(`<b>🟠 Inicio</b><br>${name}`);
  } else {
    if (state.endMarker) map.removeLayer(state.endMarker);
    state.endLatLng = ll;
    state.endMarker = L.marker(ll, { icon: iconEnd })
      .addTo(map)
      .bindPopup(`<b>🟢 Destino</b><br>${name}`);
  }

  map.panTo(ll);
  checkRoute(state, map);
}

/**
 * Clear a start or end point.
 * @param {string} type - 'start' or 'end'.
 * @param {object} state - Shared app state.
 * @param {L.Map} map - Leaflet map instance.
 */
export function clearPoint(type, state, map) {
  if (type === 'start') {
    if (state.startMarker) {
      map.removeLayer(state.startMarker);
      state.startMarker = null;
    }
    state.startLatLng = null;
    document.getElementById('startInput').value = '';
  } else {
    if (state.endMarker) {
      map.removeLayer(state.endMarker);
      state.endMarker = null;
    }
    state.endLatLng = null;
    document.getElementById('endInput').value = '';
  }

  if (state.routingControl) {
    map.removeControl(state.routingControl);
    state.routingControl = null;
    document.getElementById('routePill').style.display = 'none';
  }

  document.getElementById('mainActions').style.display = 'flex';
  document.getElementById('priceSection').style.display = 'none';
  document.getElementById('mainActions').innerHTML =
    '<button class="btn" style="background:rgba(255,255,255,.05); color:rgba(255,255,255,.3); width:100%" disabled>📍 Selecciona los puntos del viaje</button>';
  showStatus('', false);

  if (state.pollerInterval) {
    clearInterval(state.pollerInterval);
    state.pollerInterval = null;
  }
}

/**
 * Check if both points are set and calculate route.
 * @param {object} state - Shared app state.
 * @param {L.Map} map - Leaflet map instance.
 */
export function checkRoute(state, map) {
  if (!(state.startLatLng && state.endLatLng)) return;

  if (state.routingControl) {
    map.removeControl(state.routingControl);
    state.routingControl = null;
  }

  // Show loading state
  document.getElementById('mainActions').innerHTML =
    '<button class="btn" style="background:rgba(255,107,0,.15); color:#FF6B00; border:1px solid rgba(255,107,0,.3); width:100%" disabled><span class="spinner" style="border-top-color:#FF6B00; width:14px; height:14px;"></span>&nbsp; Calculando tarifa...</button>';

  const control = L.Routing.control({
    waypoints: [state.startLatLng, state.endLatLng],
    routeWhileDragging: false,
    addWaypoints: false,
    draggableWaypoints: false,
    show: false,
    lineOptions: {
      styles: [{ color: '#FF6B00', weight: 8, opacity: 0.7 }],
      addWaypoints: false
    },
    createMarker: () => null,
    router: L.Routing.osrmv1({
      serviceUrl: 'https://router.project-osrm.org/route/v1',
    }),
  });

  control.on('routesfound', (e) => {
    // 1. Limpiar estado visual
    showStatus('', false);
    const sBar = document.getElementById('statusBar');
    if (sBar) sBar.style.display = 'none';

    const r = e.routes[0];
    // Usar OSRM si da distancia real, si no, usar Haversine como respaldo
    const osrmKm = r.summary.totalDistance / 1000;
    const distKm = osrmKm > 0.05 ? osrmKm : haversineKm(state.startLatLng, state.endLatLng) * 1.3;
    const dist = distKm.toFixed(1);
    const mins = r.summary.totalTime > 0
      ? Math.round(r.summary.totalTime / 60)
      : Math.round((distKm / 25) * 60); // 25 km/h promedio en moto en zona urbana

    // 2. Mostrar datos de ruta
    const distEl = document.getElementById('routeDistance');
    const timeEl = document.getElementById('routeTime');
    const pillEl = document.getElementById('routePill');
    if (distEl) distEl.textContent = dist;
    if (timeEl) timeEl.textContent = mins;
    if (pillEl) pillEl.style.display = 'flex';

    map.fitBounds(L.latLngBounds([state.startLatLng, state.endLatLng]).pad(0.2));

    // 3. Calcular Tarifa Moto con distancia real garantizada
    showPrice(dist, mins);

    // 4. Cambiar vistas
    const actionsEl = document.getElementById('mainActions');
    const priceSecEl = document.getElementById('priceSection');
    if (actionsEl) actionsEl.style.display = 'none';
    if (priceSecEl) priceSecEl.style.display = 'block';

    if (isSheetMinimized()) toggleSheet();
  });

  control.on('routingerror', (err) => {
    console.error('Routing error:', err);
    // Aunque falle la ruta, calcular precio por Haversine como respaldo
    const distKm = haversineKm(state.startLatLng, state.endLatLng) * 1.3;
    const mins = Math.round((distKm / 25) * 60);
    const dist = distKm.toFixed(1);
    const distEl = document.getElementById('routeDistance');
    const timeEl = document.getElementById('routeTime');
    const pillEl = document.getElementById('routePill');
    if (distEl) distEl.textContent = dist;
    if (timeEl) timeEl.textContent = mins;
    if (pillEl) pillEl.style.display = 'flex';
    showPrice(dist, mins);
    showStatus('⚠️ Ruta aproximada (sin conexión a servidores de mapa).', false);
    const actionsEl = document.getElementById('mainActions');
    const priceSecEl = document.getElementById('priceSection');
    if (actionsEl) actionsEl.style.display = 'none';
    if (priceSecEl) priceSecEl.style.display = 'block';
    if (isSheetMinimized()) toggleSheet();
  });

  state.routingControl = control;
  control.addTo(map);
}
