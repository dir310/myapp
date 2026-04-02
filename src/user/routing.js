/**
 * Route calculation, marker management, and pricing.
 */
import L from 'leaflet';
import 'leaflet-routing-machine';
import { pinIcon } from '../utils/map.js';
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

  state.routingControl = L.Routing.control({
    waypoints: [state.startLatLng, state.endLatLng],
    routeWhileDragging: false,
    showAlternatives: false,
    fitSelectedRoutes: false,
    addWaypoints: false,
    draggableWaypoints: false,
    show: false,
    collapsible: true,
    lineOptions: {
      styles: [
        { color: '#FF6B00', weight: 8, opacity: 0.35 },
        { color: '#FF7A1A', weight: 4, opacity: 1 },
      ],
      extendToWaypoints: true,
      missingRouteTolerance: 0,
    },
    createMarker: () => null,
    router: L.Routing.osrmv1({
      serviceUrl: 'https://router.project-osrm.org/route/v1',
    }),
  }).addTo(map);

  // Hide the routing panel UI (instructions table) — we only want the line
  state.routingControl.on('routeselected', () => {
    const container = state.routingControl.getContainer();
    if (container) container.style.display = 'none';
  });

  state.routingControl.on('routesfound', (e) => {
    const r = e.routes[0];
    const dist = (r.summary.totalDistance / 1000).toFixed(1);
    const mins = Math.round(r.summary.totalTime / 60);

    // Update route pill
    document.getElementById('routeDistance').textContent = dist;
    document.getElementById('routeTime').textContent = mins;
    document.getElementById('routePill').style.display = 'flex';

    // Fit map to route
    map.fitBounds(L.latLngBounds([state.startLatLng, state.endLatLng]).pad(0.15));

    // Calculate Moto Price
    let calculatedPrice = BASE_FARE + (parseFloat(dist) * PER_KM_FARE) + (mins * PER_MIN_FARE);
    calculatedPrice = Math.round(calculatedPrice / 100) * 100; // Redondear a la centena más cercana
    const precio = Math.max(MIN_FARE, calculatedPrice);
    
    document.getElementById('priceValue').textContent = '$' + precio.toLocaleString('es-CO');

    // Show price section
    document.getElementById('mainActions').style.display = 'none';
    document.getElementById('priceSection').style.display = 'block';
    showStatus('', false);
    document.getElementById('statusBar').style.display = 'none';

    if (isSheetMinimized()) toggleSheet();
  });

  state.routingControl.on('routingerror', (err) => {
    console.error('Routing Error:', err);
    showStatus('❌ Error al calcular ruta.', true);
    document.getElementById('mainActions').innerHTML =
      '<button class="btn" style="background:rgba(255,255,255,.05); color:rgba(255,255,255,.3); width:100%" disabled>📍 Selecciona los puntos del viaje</button>';
  });
}
