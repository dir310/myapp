/**
 * Route calculation, marker management, and pricing.
 */
import L from 'leaflet';
import 'leaflet-routing-machine';
import { pinIcon } from '../utils/map.js';
import { toggleSheet, isSheetMinimized, showStatus } from './ui.js';
// Tarifas Moto (Estilo Picap/DiDi)
const BASE_FARE = 2500;
const PER_KM_FARE = 1000;
const PER_MIN_FARE = 120;
const MIN_FARE = 3500;

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

const iconStart = pinIcon('#30D158', 'A'); // Verde para el Punto A (Inicio)
const iconEnd = pinIcon('#FF6B00', 'B'); // Naranja para el Punto B (Destino)

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
    const input = document.getElementById('startInput');
    if (input) input.value = '';
  } else {
    if (state.endMarker) {
      map.removeLayer(state.endMarker);
      state.endMarker = null;
    }
    state.endLatLng = null;
    const input = document.getElementById('endInput');
    if (input) input.value = '';
  }

  // Limpiar rutas de cualquier tipo
  if (state.routingControl) {
    map.removeControl(state.routingControl);
    state.routingControl = null;
  }

  if (state.fallbackLine) {
    map.removeLayer(state.fallbackLine);
    state.fallbackLine = null;
  }

  // Ocultar info de ruta
  const pill = document.getElementById('routePill');
  if (pill) pill.style.display = 'none';

  // Mostrar acciones iniciales
  const actions = document.getElementById('mainActions');
  const priceSec = document.getElementById('priceSection');
  if (actions) {
    actions.style.display = 'flex';
    actions.innerHTML = '<button class="btn" style="background:rgba(255,255,255,.05); color:rgba(255,255,255,.3); width:100%" disabled>📍 Selecciona los puntos del viaje</button>';
  }
  if (priceSec) priceSec.style.display = 'none';
  
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

  // Limpiar cualquier ruta previa
  if (state.routingControl) {
    map.removeControl(state.routingControl);
    state.routingControl = null;
  }
  if (state.fallbackLine) {
    map.removeLayer(state.fallbackLine);
    state.fallbackLine = null;
  }

  // ── 1. PRECIO INSTANTÁNEO con Haversine (0ms de espera) ──
  const quickKm   = haversineKm(state.startLatLng, state.endLatLng) * 1.3;
  const quickMins = Math.round((quickKm / 22) * 60) || 1;

  const distEl = document.getElementById('routeDistance');
  const timeEl = document.getElementById('routeTime');
  const pillEl = document.getElementById('routePill');
  if (distEl) distEl.textContent = quickKm.toFixed(1);
  if (timeEl) timeEl.textContent  = quickMins;
  if (pillEl) pillEl.style.display = 'flex';

  showPrice(quickKm.toFixed(1), quickMins);

  const actionsEl = document.getElementById('mainActions');
  const priceSecEl = document.getElementById('priceSection');
  if (actionsEl) actionsEl.style.display = 'none';
  if (priceSecEl) priceSecEl.style.display = 'block';
  if (isSheetMinimized()) toggleSheet();

  // ── 2. OSRM en segundo plano: dibuja la línea naranja por las calles ──
  // No tocamos el mapa antes de addTo() para no interferir con OSRM
  const control = L.Routing.control({
    waypoints: [state.startLatLng, state.endLatLng],
    routeWhileDragging: false,
    addWaypoints: false,
    draggableWaypoints: false,
    show: false,
    fitSelectedRoutes: true,  // OSRM ajusta el mapa él mismo
    lineOptions: {
      styles: [{ color: '#FF6B00', weight: 8, opacity: 0.85 }],
      addWaypoints: false
    },
    createMarker: () => null,
    router: L.Routing.osrmv1({
      serviceUrl: 'https://router.project-osrm.org/route/v1'
    })
  });

  control.on('routesfound', (e) => {
    const r = e.routes[0];
    const distKm = r.summary.totalDistance / 1000;
    const mins   = Math.round(r.summary.totalTime / 60) || 1;
    if (distKm < 0.01) return;

    // Actualizar con datos exactos de OSRM (la línea por calles ya está dibujada)
    const distEl = document.getElementById('routeDistance');
    const timeEl = document.getElementById('routeTime');
    if (distEl) distEl.textContent = distKm.toFixed(1);
    if (timeEl) timeEl.textContent = mins;
    showPrice(distKm.toFixed(1), mins);
    showStatus('', false);
  });

  control.on('routingerror', () => {
    // OSRM falló: la UI ya tiene precio Haversine, solo ajustamos el mapa
    map.fitBounds(L.latLngBounds([state.startLatLng, state.endLatLng]).pad(0.3));
  });

  state.routingControl = control;
  control.addTo(map);
}



