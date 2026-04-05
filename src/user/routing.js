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

  // Limpiar cualquier ruta previa antes de calcular
  if (state.routingControl) {
    map.removeControl(state.routingControl);
    state.routingControl = null;
  }
  if (state.fallbackLine) {
    map.removeLayer(state.fallbackLine);
    state.fallbackLine = null;
  }

  // Feedback visual inmediato
  const actionsEl = document.getElementById('mainActions');
  if (actionsEl) {
    actionsEl.innerHTML = `
      <button class="btn" style="background:rgba(255,107,0,.15); color:#FF6B00; border:1px solid rgba(255,107,0,.3); width:100%" disabled>
        <span class="spinner" style="border-top-color:#FF6B00; width:14px; height:14px;"></span>&nbsp; Calculando tarifa definitiva...
      </button>`;
  }

  // ─── CONFIGURACIÓN DEL ROUTER ───
  // Intentamos primero con OSRM público oficial (que suele seguir las calles)
  const control = L.Routing.control({
    waypoints: [state.startLatLng, state.endLatLng],
    routeWhileDragging: false,
    addWaypoints: false,
    draggableWaypoints: false,
    show: false,
    lineOptions: {
      styles: [
        { color: '#000', weight: 10, opacity: 0.3 }, // Borde/Sombra
        { color: '#FF6B00', weight: 6, opacity: 1 }    // Línea principal
      ],
      addWaypoints: false
    },
    createMarker: () => null, // No duplicar marcadores
    router: L.Routing.osrmv1({
      serviceUrl: 'https://router.project-osrm.org/route/v1',
      timeout: 8000 // Aumentamos un poco el timeout para evitar fallos por red lenta
    }),
  });

  control.on('routesfound', (e) => {
    const r = e.routes[0];
    const distKm = r.summary.totalDistance / 1000;
    const mins = Math.round(r.summary.totalTime / 60) || 1;
    
    // Si la distancia es ridículamente corta (error de servidor), ignorar
    if (distKm < 0.01) return;

    // Actualizar Píldora de Info
    const distEl = document.getElementById('routeDistance');
    const timeEl = document.getElementById('routeTime');
    const pillEl = document.getElementById('routePill');
    if (distEl) distEl.textContent = distKm.toFixed(1);
    if (timeEl) timeEl.textContent = mins;
    if (pillEl) pillEl.style.display = 'flex';

    // Ajustar mapa
    map.fitBounds(L.latLngBounds([state.startLatLng, state.endLatLng]).pad(0.3));

    // Mostrar Precio
    showPrice(distKm.toFixed(1), mins);

    // Activar sección de pedido
    document.getElementById('mainActions').style.display = 'none';
    document.getElementById('priceSection').style.display = 'block';

    if (isSheetMinimized()) toggleSheet();
    showStatus('', false);
  });

  control.on('routingerror', (err) => {
    console.warn('OSRM falló, usando cálculo de contingencia (haversine)...');
    
    // Fallback: Línea sólida pero con estilo de "estimación"
    const distKm = haversineKm(state.startLatLng, state.endLatLng) * 1.35; // Factor de curvatura estimado
    const mins = Math.round((distKm / 20) * 60); // Estimación moto 20km/h
    
    state.fallbackLine = L.polyline([state.startLatLng, state.endLatLng], {
      color: '#FF6B00',
      weight: 5,
      opacity: 0.6,
      dashArray: 'none' // Línea sólida para evitar confusión con "cortado"
    }).addTo(map);

    const distEl = document.getElementById('routeDistance');
    const timeEl = document.getElementById('routeTime');
    if (distEl) distEl.textContent = distKm.toFixed(1);
    if (timeEl) timeEl.textContent = mins;
    document.getElementById('routePill').style.display = 'flex';

    showPrice(distKm.toFixed(1), mins);
    showStatus('⚠️ Servidor de rutas lento. Tarifa calculada por distancia aérea.', false);

    document.getElementById('mainActions').style.display = 'none';
    document.getElementById('priceSection').style.display = 'block';

    map.fitBounds(L.latLngBounds([state.startLatLng, state.endLatLng]).pad(0.3));
    if (isSheetMinimized()) toggleSheet();
  });

  state.routingControl = control;
  control.addTo(map);
}



