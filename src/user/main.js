/**
 * User page entry point — wires all modules together.
 */
import '../styles/common.css';
import '../styles/user.css';

import { createMap, LA_CALERA } from '../utils/map.js';
import { toggleSheet, setMode, showStatus, isSheetMinimized } from './ui.js';
import { onInput, showLocationSugg, setupSuggestionDismiss } from './geocoding.js';
import { placeMarker, clearPoint, checkRoute } from './routing.js';
import { acceptRide, cancelRide } from './ride.js';

// ── Shared State ──
const state = {
  startLatLng: null,
  endLatLng: null,
  startMarker: null,
  endMarker: null,
  routingControl: null,
  mode: 'search',
  nextClick: 'start',
  currentRideId: null,
  pollerInterval: null,
};

// ── Initialize Map ──
const map = createMap('map', LA_CALERA, 13);

// ── Bound Helpers (curried with state & map) ──
const boundPlaceMarker = (type, lat, lng, name) => placeMarker(type, lat, lng, name, state, map);
const boundClearPoint = (type) => clearPoint(type, state, map);

// ── Event Listeners ──

// Sidebar tab toggle
document.getElementById('sidebarHeader').addEventListener('click', toggleSheet);

// Mode buttons
document.getElementById('modeSearchBtn').addEventListener('click', () => setMode('search', state, map));
document.getElementById('modeClickBtn').addEventListener('click', () => setMode('click', state, map));

// Search inputs
document.getElementById('startInput').addEventListener('input', (e) => onInput(e.target, 'start', boundPlaceMarker));
document.getElementById('startInput').addEventListener('focus', () => showLocationSugg(boundPlaceMarker));
document.getElementById('endInput').addEventListener('input', (e) => onInput(e.target, 'end', boundPlaceMarker));

// Clear buttons
document.querySelectorAll('.clear-btn').forEach((btn, i) => {
  const type = i === 0 ? 'start' : 'end';
  btn.addEventListener('click', () => boundClearPoint(type));
});

// Map click (for 'click' mode)
map.on('click', (e) => {
  if (state.mode !== 'click') {
    if (!isSheetMinimized()) toggleSheet();
    return;
  }

  const { lat, lng } = e.latlng;
  const name = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;

  if (state.nextClick === 'start') {
    boundPlaceMarker('start', lat, lng, name);
    state.nextClick = 'end';
    showStatus('📍 Inicio colocado.', false);
  } else {
    boundPlaceMarker('end', lat, lng, name);
    state.nextClick = 'start';
    showStatus('📍 Destino colocado. Calculando...', false);
  }
});

// Price section buttons — delegated since they're rebuilt dynamically
document.getElementById('priceSection').addEventListener('click', (e) => {
  const target = e.target.closest('button');
  if (!target) return;

  if (target.id === 'acceptRideBtn') {
    acceptRide(state, map);
  } else if (target.id === 'cancelRideBtn' || target.id === 'cancelSearchBtn') {
    cancelRide(state, map);
  }
});

// Rating Stars interaction
let selectedRating = 0;
document.querySelectorAll('.star').forEach(star => {
    star.addEventListener('click', () => {
        selectedRating = parseInt(star.getAttribute('data-value'));
        document.querySelectorAll('.star').forEach(s => {
            s.classList.toggle('selected', parseInt(s.getAttribute('data-value')) <= selectedRating);
        });
    });
});

// Submit Rating
document.getElementById('submitRatingBtn').addEventListener('click', async () => {
    if(selectedRating === 0) { alert("Por favor selecciona una calificación"); return; }
    
    document.getElementById('ratingOverlay').innerHTML = `
        <div class="rating-card">
            <div style="font-size: 50px; margin-bottom: 15px;">🌟</div>
            <h2 style="color: #30D158; font-weight: 800; margin-bottom: 10px;">¡Gracias!</h2>
            <p style="color: rgba(255,255,255,.6); font-size: 14px;">Tu calificación nos ayuda a mejorar.</p>
        </div>
    `;
    
    if(state.currentRideId) {
        await supabase.from('viajes').update({ calificacion: selectedRating }).eq('id', state.currentRideId);
    }
    
    setTimeout(() => {
        document.getElementById('ratingOverlay').style.display = 'none';
        location.reload();
    }, 1800);
});
// Suggestion dismiss on outside click
setupSuggestionDismiss();

// ── Register Service Worker (PWA) ──
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register(new URL('/sw.js', import.meta.url).href).catch(console.log);
}
