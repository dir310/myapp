/**
 * Geocoding via Nominatim: search, suggestions, and current location.
 */
import { showStatus } from './ui.js';

const timers = {};

/**
 * Handle input events with debounce for geocoding.
 * @param {HTMLInputElement} input - The input element.
 * @param {string} type - 'start' or 'end'.
 * @param {Function} placeMarkerFn - Callback to place marker on selection.
 * @param {object} state - Shared app state.
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
 * Show shortcut suggestions for an input.
 * @param {string} type - 'start' or 'end'.
 * @param {Function} placeMarkerFn - Callback.
 * @param {object} state - App state to update nextClick.
 */
export function showLocationSugg(type, placeMarkerFn, state) {
  const input = document.getElementById(type + 'Input');
  if (input.value.trim() !== '') return;

  const sugg = document.getElementById(type + 'Suggestions');
  let html = '';

  if (type === 'start') {
    html += `<div class="suggestion-item curr-loc" id="useLocBtn"><span class="sugg-icon">🎯</span> Usar mi ubicación actual</div>`;
  }

  html += `<div class="suggestion-item mode-click" id="clickMapBtn"><span class="sugg-icon">📍</span> Tocar en el mapa</div>`;
  
  sugg.innerHTML = html;
  sugg.style.display = 'block';

  // Attach handlers
  const useLoc = document.getElementById('useLocBtn');
  if (useLoc) {
    useLoc.addEventListener('click', () => useCurrentLocation(placeMarkerFn));
  }

  const clickMap = document.getElementById('clickMapBtn');
  if (clickMap) {
    clickMap.addEventListener('click', () => {
      state.nextClick = type;
      state.mapClickTarget = type; // Gate: habilita exactamente UN toque en el mapa para este punto
      sugg.style.display = 'none';
      const hint = document.getElementById('clickHint');
      if (hint) {
        hint.style.display = 'block';
        hint.textContent = type === 'start' ? '🟢 Toca el inicio en el mapa' : '🟠 Toca el destino en el mapa';
      }
    });
  }
}

/**
 * Use browser geolocation to get current position.
 * @param {Function} placeMarkerFn - Callback: placeMarker(type, lat, lng, name).
 */
export function useCurrentLocation(placeMarkerFn) {
  document.getElementById('startSuggestions').style.display = 'none';

  if (!navigator.geolocation) {
    showStatus('❌ Tu navegador no soporta ubicación.', true);
    return;
  }

  document.getElementById('startInput').value = 'Buscando GPS...';

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;

      fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`)
        .then((r) => r.json())
        .then((data) => {
          let name = 'Mi ubicación actual';
          if (data.address && (data.address.road || data.address.neighbourhood)) {
            name = (data.address.road || '') + ' ' + (data.address.neighbourhood || '');
          }
          document.getElementById('startInput').value = name;
          placeMarkerFn('start', lat, lon, name);
        })
        .catch(() => {
          document.getElementById('startInput').value = 'Mi ubicación actual';
          placeMarkerFn('start', lat, lon, 'Mi ubicación actual');
        });
    },
    () => {
      showStatus('❌ Activa el GPS y permisos.', true);
      document.getElementById('startInput').value = '';
    },
    { enableHighAccuracy: true }
  );
}

/**
 * Query Nominatim for geocoding results.
 * @param {string} q - Search query.
 * @param {string} type - 'start' or 'end'.
 * @param {Function} placeMarkerFn - Callback to place marker on selection.
 */
async function geocode(q, type, placeMarkerFn) {
  try {
    let res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q + ' Cundinamarca Colombia')}&format=json&limit=5&countrycodes=co`
    );
    let data = await res.json();

    if (!data.length) {
      res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q + ' Colombia')}&format=json&limit=5&countrycodes=co`
      );
      data = await res.json();
    }

    renderSugg(data, type, placeMarkerFn, state);
  } catch (e) {
    // Silently fail — network issues
  }
}

/**
 * Render suggestion dropdown items.
 */
function renderSugg(data, type, placeMarkerFn, state) {
  const el = document.getElementById(type + 'Suggestions');

  if (!data.length) {
    if (document.getElementById(type + 'Input').value === '') {
      showLocationSugg(type, placeMarkerFn, state);
    } else {
      el.style.display = 'none';
    }
    return;
  }

  let html = '';
  if (type === 'start') {
    html += `<div class="suggestion-item curr-loc" data-action="use-location"><span class="sugg-icon">🎯</span> Usar mi ubicación actual</div>`;
  }

  html += data
    .map(
      (d, i) =>
        `<div class="suggestion-item" data-action="select" data-index="${i}"><span class="sugg-icon">📍</span>${d.display_name.slice(0, 72)}</div>`
    )
    .join('');

  el.innerHTML = html;
  el.style.display = 'block';

  // Attach event listeners via delegation
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
 * Handle suggestion selection.
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
