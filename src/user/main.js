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
import { supabase } from '../config/supabase.js';

// ── Shared State ──
const state = {
  startLatLng: null,
  endLatLng: null,
  startMarker: null,
  endMarker: null,
  routingControl: null,
  mode: 'click',       // Por defecto: tocar mapa
  nextClick: 'start',
  currentRideId: null,
  pollerInterval: null,
};

// ── Passenger Auth Logic ──
function checkPassengerAuth() {
  const nombre = localStorage.getItem('calmovil_cliente_nombre');
  const cedula = localStorage.getItem('calmovil_cliente_cedula');
  const telefono = localStorage.getItem('calmovil_cliente_telefono');

  const overlay = document.getElementById('passengerAuthOverlay');
  const profileWidget = document.getElementById('passengerProfileDisplay');

  if (!nombre || !cedula || !telefono) {
    if (overlay) {
      overlay.style.display = 'flex';
      // Ensure the form is in "Login" mode by default if shown
      setAuthMode('login');
    }
    if (profileWidget) profileWidget.style.display = 'none';
  } else {
    if (overlay) overlay.style.display = 'none';
    // Fill the sidebar widget
    if (profileWidget) {
        profileWidget.style.display = 'flex';
        document.getElementById('displayClientName').textContent = nombre;
        document.getElementById('displayClientPhone').textContent = telefono;
    }
  }
}
checkPassengerAuth();

function setAuthMode(mode) {
  const btn = document.getElementById('savePassengerAuthBtn');
  const switchBtn = document.getElementById('authSwitchBtn');
  const switchText = document.getElementById('authSwitchText');
  const nombreGroup = document.getElementById('authNombre').closest('div');
  const cedulaLabel = document.getElementById('authCedula').previousElementSibling;
  const nombreLabel = document.getElementById('authNombre').previousElementSibling;

  if (mode === 'register') {
    btn.textContent = 'Registrarme y Entrar';
    switchBtn.textContent = '¡Ya tengo cuenta!';
    switchText.textContent = '¿Ya eres usuario?';
    nombreGroup.style.display = 'block';
    if(nombreLabel) nombreLabel.style.display = 'block';
  } else {
    btn.textContent = 'Ingresar';
    switchBtn.textContent = '¡Registrarme!';
    switchText.textContent = '¿No tienes cuenta?';
    // For login, we can still ask for everything or just phone/cedula. 
    // To keep it simple and ensure "registration" feel, let's just keep all fields but change text.
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('savePassengerAuthBtn');
  if (btn) {
    btn.addEventListener('click', async () => {
      const n = document.getElementById('authNombre').value;
      const c = document.getElementById('authCedula').value;
      const t = document.getElementById('authTelefono').value;
      const terms = document.getElementById('authTerms').checked;

      if (!n || !c || !t) return alert('Por favor llena todos los campos obligatorios (*) para continuar.');
      if (!terms) return alert('Debes marcar la casilla aceptando los términos de responsabilidad para poder continuar.');

      btn.disabled = true;
      const originalText = btn.textContent;
      btn.textContent = 'Validando...';

      try {
        // Enviar a Supabase — si ya existe lo actualiza
        await supabase.from('clientes').upsert([{ 
          cedula: c, 
          nombre: n, 
          telefono: t 
        }]);

        // Guardar local
        localStorage.setItem('calmovil_cliente_nombre', n);
        localStorage.setItem('calmovil_cliente_cedula', c);
        localStorage.setItem('calmovil_cliente_telefono', t);

        document.getElementById('passengerAuthOverlay').style.display = 'none';
        checkPassengerAuth();
      } catch (err) {
        alert('Hubo un error al conectar con el servidor. Inténtalo de nuevo.');
        console.error('Auth error:', err);
      } finally {
        btn.disabled = false;
        btn.textContent = originalText;
      }
    });
  }

  const switchBtn = document.getElementById('authSwitchBtn');
  if (switchBtn) {
    switchBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const isLogin = document.getElementById('savePassengerAuthBtn').textContent === 'Ingresar';
      setAuthMode(isLogin ? 'register' : 'login');
    });
  }

  // ── Registration Form Handlers ──
  const editBtn = document.getElementById('editPassengerBtn');
  if (editBtn) {
      editBtn.addEventListener('click', () => {
          document.getElementById('authNombre').value = localStorage.getItem('calmovil_cliente_nombre') || '';
          document.getElementById('authCedula').value = localStorage.getItem('calmovil_cliente_cedula') || '';
          document.getElementById('authTelefono').value = localStorage.getItem('calmovil_cliente_telefono') || '';
          document.getElementById('authTerms').checked = true; // They accepted it before
          document.getElementById('passengerAuthOverlay').style.display = 'flex';
          
          const saveBtn = document.getElementById('savePassengerAuthBtn');
          if (saveBtn) saveBtn.textContent = 'Guardar Cambios';
      });
  }

  const logoutBtn = document.getElementById('logoutPassengerBtn');
  if (logoutBtn) {
      logoutBtn.addEventListener('click', () => {
          if(confirm('¿Estás seguro de que quieres cerrar sesión? Asegúrate de no tener un viaje activo.')) {
              localStorage.removeItem('calmovil_cliente_nombre');
              localStorage.removeItem('calmovil_cliente_cedula');
              localStorage.removeItem('calmovil_cliente_telefono');
              // Usar 'authTerms' as a flag is unneeded since it's re-checked on form.
              document.getElementById('authNombre').value = '';
              document.getElementById('authCedula').value = '';
              document.getElementById('authTelefono').value = '';
              document.getElementById('authTerms').checked = false;
              checkPassengerAuth();
          }
      });
  }
});
// ── Initialize Map ──
const map = createMap('map', LA_CALERA, 13);

// ── Bound Helpers (curried with state & map) ──
const boundPlaceMarker = (type, lat, lng, name) => placeMarker(type, lat, lng, name, state, map);
const boundClearPoint = (type) => clearPoint(type, state, map);

// ── Activar modo por defecto: Tocar Mapa ──
setMode('click', state, map);

// ── Event Listeners ──

// Sidebar tab toggle
document.getElementById('sidebarHeader').addEventListener('click', toggleSheet);

// Mode buttons
document.getElementById('modeSearchBtn').addEventListener('click', () => setMode('search', state, map));
document.getElementById('modeClickBtn').addEventListener('click', () => setMode('click', state, map));

// Reset points button
document.getElementById('resetPointsBtn').addEventListener('click', () => {
  boundClearPoint('start');
  boundClearPoint('end');
  state.nextClick = 'start';
  showStatus('✨ Puntos reiniciados. Selecciona donde inicias.', false);
  
  // Dar feedback visual al botón
  const btn = document.getElementById('resetPointsBtn');
  const originalText = btn.innerHTML;
  btn.innerHTML = '✅ Reiniciado';
  setTimeout(() => btn.innerHTML = originalText, 1500);
});

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
    state.nextClick = 'end';
    // Actualizar hint para guiar al segundo toque
    const hint = document.getElementById('clickHint');
    if (hint) hint.textContent = '🟠 Ahora toca el destino en el mapa';
    showStatus('', false); // Sin texto extra, el hint ya orienta
    boundPlaceMarker('start', lat, lng, name);
  } else {
    state.nextClick = 'start';
    // La tarifa y la línea naranja aparecen solas — no mostrar texto de calculando
    const hint = document.getElementById('clickHint');
    if (hint) hint.textContent = 'Toca el mapa para colocar inicio y destino';
    showStatus('', false);
    boundPlaceMarker('end', lat, lng, name);
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
