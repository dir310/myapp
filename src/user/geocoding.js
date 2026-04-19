/**
 * Geocoding via Nominatim: search, suggestions, and current location.
 */
import { showStatus } from './ui.js';

const timers = {};

// ── Área de cobertura ZIPPY (viewbox para Nominatim) ──────────────────────────
// Cubre: La Calera, Sopó, Guasca y el corredor de la Carrera 7ma
const VIEWBOX = '-74.20,5.05,-73.75,4.55'; // lon_min,lat_max,lon_max,lat_min

/**
 * Handle input events with debounce for geocoding.
 * @param {HTMLInputElement} input
 * @param {string} type - 'start' or 'end'
 * @param {Function} placeMarkerFn
 * @param {object} state
 */
export function onInput(input, type, placeMarkerFn, state) {
  const val = input.value.trim();
  clearTimeout(timers[type]);

  const el = document.getElementById(type + 'Suggestions');
  if (val.length < 3) {
    if (val.length === 0) {
      showLocationSugg(type, placeMarkerFn, state);
    } else {
      el.style.display = 'none';
    }
    return;
  }

  timers[type] = setTimeout(() => geocode(val, type, placeMarkerFn, state), 420);
}

/**
 * Show shortcut suggestions for an input (empty state).
 * @param {string} type - 'start' or 'end'
 * @param {Function} placeMarkerFn
 * @param {object} state
 */
export function showLocationSugg(type, placeMarkerFn, state) {
  const input = document.getElementById(type + 'Input');
  if (input.value.trim() !== '') return;

  const sugg = document.getElementById(type + 'Suggestions');
  let html = '';

  if (type === 'start') {
    html += `<div class="suggestion-item curr-loc" id="useLocBtn">
               <span class="sugg-icon">🎯</span> Usar mi ubicación actual
             </div>`;
  }

  html += `<div class="suggestion-item mode-click" id="clickMapBtn">
             <span class="sugg-icon">📍</span> Tocar en el mapa
           </div>`;

  sugg.innerHTML = html;
  sugg.style.display = 'block';

  // Usar sugg.querySelector para evitar conflicto con IDs duplicados entre A y B
  const useLoc = sugg.querySelector('#useLocBtn');
  if (useLoc) {
    useLoc.addEventListener('click', () => useCurrentLocation(placeMarkerFn));
  }

  const clickMap = sugg.querySelector('#clickMapBtn');
  if (clickMap) {
    clickMap.addEventListener('click', () => {
      state.nextClick = type;
      state.mapClickTarget = type; // Habilita exactamente UN toque en el mapa para este punto
      sugg.style.display = 'none';
      const hint = document.getElementById('clickHint');
      if (hint) {
        hint.style.display = 'block';
        hint.textContent = type === 'start'
          ? '🟢 Toca el inicio en el mapa'
          : '🟠 Toca el destino en el mapa';
      }
    });
  }
}

/**
 * Use browser geolocation to fill point A.
 * @param {Function} placeMarkerFn
 */
export function useCurrentLocation(placeMarkerFn) {
  document.getElementById('startSuggestions').style.display = 'none';

  if (!navigator.geolocation) {
    showStatus('❌ Tu navegador no soporta ubicación.', true);
    return;
  }

  document.getElementById('startInput').value = '📡 Buscando GPS...';

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;

      fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=17&addressdetails=1`)
        .then((r) => r.json())
        .then((data) => {
          const a = data.address || {};
          const name = a.road
            ? `${a.road}${a.house_number ? ' ' + a.house_number : ''}${a.suburb ? ', ' + a.suburb : ''}`
            : (a.neighbourhood || a.village || a.town || 'Mi ubicación actual');
          document.getElementById('startInput').value = name;
          placeMarkerFn('start', lat, lon, name);
        })
        .catch(() => {
          document.getElementById('startInput').value = 'Mi ubicación actual';
          placeMarkerFn('start', lat, lon, 'Mi ubicación actual');
        });
    },
    () => {
      showStatus('❌ Activa el GPS y los permisos de ubicación.', true);
      document.getElementById('startInput').value = '';
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

/**
 * Query Nominatim for geocoding results.
 * Estrategia en 3 pasos:
 *   1. Búsqueda local (viewbox + bounded) → más precisa para La Calera / Sopó
 *   2. Si no hay resultados: búsqueda en Cundinamarca sin bounded
 *   3. Si sigue sin haber: búsqueda general en Colombia
 *
 * @param {string} q - Search query
 * @param {string} type - 'start' or 'end'
 * @param {Function} placeMarkerFn
 * @param {object} state
 */
async function geocode(q, type, placeMarkerFn, state) {
  try {
    const base = 'https://nominatim.openstreetmap.org/search';
    const common = `format=json&limit=6&countrycodes=co&addressdetails=1`;

    // 1. Búsqueda local restringida al área de cobertura
    let res = await fetch(
      `${base}?q=${encodeURIComponent(q)}&${common}&viewbox=${VIEWBOX}&bounded=1`
    );
    let data = await res.json();

    // 2. Sin bounded pero con Cundinamarca como contexto
    if (!data.length) {
      res = await fetch(
        `${base}?q=${encodeURIComponent(q + ' Cundinamarca Colombia')}&${common}&viewbox=${VIEWBOX}`
      );
      data = await res.json();
    }

    // 3. Búsqueda amplia en Colombia
    if (!data.length) {
      res = await fetch(
        `${base}?q=${encodeURIComponent(q + ' Colombia')}&${common}`
      );
      data = await res.json();
    }

    renderSugg(data, type, placeMarkerFn, state);
  } catch {
    // Red no disponible — falla silenciosamente
  }
}

/**
 * Render suggestion dropdown items.
 * Muestra el nombre principal separado de la dirección completa.
 */
function renderSugg(data, type, placeMarkerFn, state) {
  const el = document.getElementById(type + 'Suggestions');

  if (!data.length) {
    // Si no hay resultados y el campo sigue vacío, volver a los accesos rápidos
    if (document.getElementById(type + 'Input').value.trim() === '') {
      showLocationSugg(type, placeMarkerFn, state);
    } else {
      el.innerHTML = `<div class="suggestion-item" style="color:rgba(255,255,255,0.35);cursor:default;">
        <span class="sugg-icon">🔍</span> Sin resultados — intenta con otro nombre
      </div>`;
      el.style.display = 'block';
    }
    return;
  }

  let html = '';
  if (type === 'start') {
    html += `<div class="suggestion-item curr-loc" data-action="use-location">
               <span class="sugg-icon">🎯</span> Usar mi ubicación actual
             </div>`;
  }

  html += data.map((d, i) => {
    // Nombre principal: nombre del lugar o primera parte de display_name
    const a = d.address || {};
    const mainName = d.name
      || a.road
      || a.neighbourhood
      || a.village
      || a.town
      || d.display_name.split(',')[0];

    // Subtítulo: municipio + departamento
    const sub = [a.municipality || a.city || a.town || a.village, a.state]
      .filter(Boolean).join(', ') || d.display_name.split(',').slice(1, 3).join(',').trim();

    return `<div class="suggestion-item" data-action="select" data-index="${i}">
              <span class="sugg-icon">📍</span>
              <span>
                <span style="display:block;font-weight:600;color:#fff;">${mainName.slice(0, 50)}</span>
                <span style="display:block;font-size:10px;color:rgba(255,255,255,0.4);margin-top:1px;">${sub.slice(0, 55)}</span>
              </span>
            </div>`;
  }).join('');

  el.innerHTML = html;
  el.style.display = 'block';

  // Listeners vía querySelectorAll — seguros contra IDs duplicados
  el.querySelectorAll('[data-action="use-location"]').forEach((btn) => {
    btn.addEventListener('click', () => useCurrentLocation(placeMarkerFn));
  });

  el.querySelectorAll('[data-action="select"]').forEach((btn) => {
    const i = parseInt(btn.dataset.index);
    const d = data[i];
    btn.addEventListener('click', () => {
      selectSugg(type, parseFloat(d.lat), parseFloat(d.lon), d.display_name.replace(/`/g, "'").slice(0, 70), placeMarkerFn);
    });
  });
}

/**
 * Handle suggestion selection — fills input and places marker.
 */
function selectSugg(type, lat, lng, name, placeMarkerFn) {
  document.getElementById(type + 'Input').value = name;
  document.getElementById(type + 'Suggestions').style.display = 'none';
  placeMarkerFn(type, lat, lng, name);
}

/**
 * Setup click-outside listener to close suggestion dropdowns.
 */
export function setupSuggestionDismiss() {
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.input-wrapper')) {
      document.querySelectorAll('.suggestions').forEach((s) => (s.style.display = 'none'));
    }
  });
}
