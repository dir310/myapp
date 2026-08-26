/**
 * Route calculation, marker management, and pricing.
 */
import L from 'leaflet';
import { pinIcon, COVERAGE_POLYGON, isPointInPolygon } from '../utils/map.js';
import { toggleSheet, isSheetMinimized, showStatus, showCoverageModal } from './ui.js';
import { sanitizeHTML } from '../utils/security.js';

// ── Tarifas Moto ───────────────────────────────────────────────────────────
const BASE_FARE = 2700;
const PER_KM_FARE = 1000;
const PER_MIN_FARE = 120;
const MIN_FARE = 3400;

function haversineKm(a, b) {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function showPrice(distKm, mins) {
  const km = parseFloat(distKm) || 0;
  let price = BASE_FARE + (km * PER_KM_FARE) + (mins * PER_MIN_FARE);
  price = Math.round(price / 100) * 100;
  price = Math.max(MIN_FARE, price);
  price = Math.round((price * 1.03) + 500);
  price = price - 600; // Reducción total de $600 pesos en la tarifa
  price = Math.max(4000, price); // Garantizar que la tarifa mínima NUNCA baje de 4000
  
  // Agregar multa pendiente si existe
  const multa = window.zippyCurrentMulta || 0;
  price += multa;

  window.zippyCurrentBasePrice = price;

  const bonoCb = document.getElementById('useBonoCheckbox');
  const bonoContainer = document.getElementById('bonoContainer');
  const multaContainer = document.getElementById('multaContainer');

  if (bonoCb) bonoCb.checked = false; // Resetear al calcular nueva ruta

  if (bonoContainer) {
    if (window.zippyCurrentBono && window.zippyCurrentBono > 0) {
      bonoContainer.style.display = 'flex';
    } else {
      bonoContainer.style.display = 'none';
    }
  }

  if (multaContainer) {
    multaContainer.style.display = (multa > 0) ? 'block' : 'none';
  }

  const el = document.getElementById('priceValue');
  if (el) el.textContent = '$' + price.toLocaleString('es-CO');
  return price;
}

// ── Íconos ─────────────────────────────────────────────────────────────────
const iconStart = pinIcon('#30D158', 'A');
const iconEnd = pinIcon('#FF6B00', 'B');

// ── Marcadores ─────────────────────────────────────────────────────────────
export function placeMarker(type, lat, lng, name, state, map) {
  const ll = L.latLng(lat, lng);
  const cleanName = sanitizeHTML(name, 100);

  // Validación de Cobertura
  if (!isPointInPolygon({ lat, lng }, COVERAGE_POLYGON)) {
    showCoverageModal();
    // Borrar el punto y limpiar el input para que no quede nada
    if (type === 'start') {
      if (state.startMarker) map.removeLayer(state.startMarker);
      state.startLatLng = null;
      state.startMarker = null;
      const input = document.getElementById('startInput');
      if (input) input.value = '';
    } else {
      if (state.endMarker) map.removeLayer(state.endMarker);
      state.endLatLng = null;
      state.endMarker = null;
      const input = document.getElementById('endInput');
      if (input) input.value = '';
    }
    return;
  }

  if (type === 'start') {
    if (state.startMarker) map.removeLayer(state.startMarker);
    state.startLatLng = ll;
    state.startMarker = L.marker(ll, { icon: iconStart }).addTo(map)
      .bindPopup(`<b>🟢 Inicio</b><br>${cleanName}`);
    const input = document.getElementById('startInput');
    if (input) input.value = cleanName;
  } else {
    if (state.endMarker) map.removeLayer(state.endMarker);
    state.endLatLng = ll;
    state.endMarker = L.marker(ll, { icon: iconEnd }).addTo(map)
      .bindPopup(`<b>🟠 Destino</b><br>${cleanName}`);
    const input = document.getElementById('endInput');
    if (input) input.value = cleanName;
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

  const confirmBtn = document.getElementById('confirmRouteBtn');
  if (confirmBtn) confirmBtn.style.display = 'none';

  if (state.routeLine) { map.removeLayer(state.routeLine); state.routeLine = null; }

  const pill = document.getElementById('routePill');
  if (pill) pill.style.display = 'none';

  const actions = document.getElementById('mainActions');
  const priceSec = document.getElementById('priceSection');
  if (actions) {
    actions.style.display = 'flex';
    actions.innerHTML = '<button class="btn" style="background:rgba(255,255,255,.05);color:rgba(255,255,255,.3);width:100%" disabled>📍 Selecciona los puntos del viaje</button>';
  }
  if (priceSec) priceSec.style.display = 'none';
  showStatus('', false);
}

// ── Dibujar polilínea (Naranja con borde oscuro) ──────────────────────────
function renderRouteOnMap(coords, state, map) {
  if (state.routeLine) {
    map.removeLayer(state.routeLine);
    state.routeLine = null;
  }

  // Dibujamos un "borde" oscuro para visibilidad y la línea naranja brillante (curva)
  state.routeLine = L.featureGroup([
    L.polyline(coords, { color: '#000', weight: 15, opacity: 0.4, lineCap: 'round' }),
    L.polyline(coords, { color: '#FF6B00', weight: 8, opacity: 1, className: 'animated-main-route' })
  ]).addTo(map);
}

// ── Cálculo de ruta (INMEDIATO -> REAL) ───────────────────────────────────
export function checkRoute(state, map) {
  if (!(state.startLatLng && state.endLatLng)) return;

  // 1. Mostrar Pills y Precio Haversine al instante
  const quickKm = haversineKm(state.startLatLng, state.endLatLng) * 1.3;
  const quickMins = Math.round((quickKm / 22) * 60) || 1;

  const distEl = document.getElementById('routeDistance');
  const timeEl = document.getElementById('routeTime');
  const pillEl = document.getElementById('routePill');

  if (distEl) distEl.textContent = quickKm.toFixed(1);
  if (timeEl) timeEl.textContent = quickMins;
  if (pillEl) pillEl.style.display = 'flex';

  showPrice(quickKm.toFixed(1), quickMins);
  const mainActions = document.getElementById('mainActions');
  if (mainActions) mainActions.style.display = 'none';
  document.getElementById('priceSection').style.display = 'block';

  // Configurar visibilidad del botón Pedir Viaje (Solo para tiempo real, Ocultar en agendado)
  const pedirBtn = document.getElementById('pedirViajeBtn');
  if (pedirBtn) {
    if (state.isScheduling) {
      pedirBtn.style.display = 'none';
    } else {
      pedirBtn.style.display = 'block';
      pedirBtn.innerHTML = '🏍️ Pedir Viaje';
    }
  }

  // Desplegar automáticamente el panel inferior con precio y pago
  const sidebar = document.getElementById('sidebar');
  if (sidebar && sidebar.classList.contains('minimized')) {
    sidebar.classList.remove('minimized');
  }

  map.fitBounds(L.latLngBounds([state.startLatLng, state.endLatLng]).pad(0.3));

  const confirmBtn = document.getElementById('confirmRouteBtn');
  if (confirmBtn) confirmBtn.style.display = 'flex';

  // 1.1 ELIMINADO: Ya no dibujamos línea recta. Esperamos a la curva por la vía.

  // 2. PEDIR RUTA REAL A OSRM (Directo preferido por velocidad)
  const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${state.startLatLng.lng},${state.startLatLng.lat};${state.endLatLng.lng},${state.endLatLng.lat}?overview=full&geometries=geojson`;

  // Intentamos directo primero, si falla usamos proxy, si falla dibujamos línea recta
  fetch(osrmUrl)
    .then(r => {
      if (!r.ok) throw new Error('OSRM Direct Fail');
      return r.json();
    })
    .catch(() => fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(osrmUrl)}`).then(r => r.json()))
    .then(data => {
      if (data.code !== 'Ok' || !data.routes?.length) throw new Error('No routes in response');
      const route = data.routes[0];
      const curvyCoords = route.geometry.coordinates.map(c => [c[1], c[0]]);
      renderRouteOnMap(curvyCoords, state, map);
    })
    .catch(err => {
      console.error('[ZIPPY] Error en ruteo, dibujando línea recta de respaldo:', err);
      renderRouteOnMap([state.startLatLng, state.endLatLng], state, map);
    });
}
