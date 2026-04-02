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
    const dist = (r.summary.totalDistance / 1000).toFixed(1);
    const mins = Math.round(r.summary.totalTime / 60);

    // 2. Mostrar datos de ruta
    const distEl = document.getElementById('routeDistance');
    const timeEl = document.getElementById('routeTime');
    const pillEl = document.getElementById('routePill');
    if (distEl) distEl.textContent = dist;
    if (timeEl) timeEl.textContent = mins;
    if (pillEl) pillEl.style.display = 'flex';

    map.fitBounds(L.latLngBounds([state.startLatLng, state.endLatLng]).pad(0.2));

    // 3. Calcular Tarifa Moto (Validadas)
    let calculatedPrice = BASE_FARE + (parseFloat(dist) * PER_KM_FARE) + (mins * PER_MIN_FARE);
    calculatedPrice = Math.round(calculatedPrice / 100) * 100;
    const precio = Math.max(MIN_FARE, calculatedPrice);
    
    const priceValEl = document.getElementById('priceValue');
    if (priceValEl) priceValEl.textContent = '$' + precio.toLocaleString('es-CO');

    // 4. Cambiar vistas
    const actionsEl = document.getElementById('mainActions');
    const priceSecEl = document.getElementById('priceSection');
    if (actionsEl) actionsEl.style.display = 'none';
    if (priceSecEl) priceSecEl.style.display = 'block';

    if (isSheetMinimized()) toggleSheet();
  });

  control.on('routingerror', (err) => {
    console.error('Routing error:', err);
    showStatus('❌ Error de conexión. Intenta de nuevo.', true);
    const actionsEl = document.getElementById('mainActions');
    if (actionsEl) {
      actionsEl.innerHTML = '<button class="btn btn-primary" id="retryRouteBtn" style="width:100%">Recalcular Ruta</button>';
      document.getElementById('retryRouteBtn')?.addEventListener('click', () => checkRoute(state, map));
    }
  });

  state.routingControl = control;
  control.addTo(map);
}
