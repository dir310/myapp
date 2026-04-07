/**
 * User page entry point — wires all modules together. build:20260406-v8
 */
import '../styles/common.css';
import '../styles/user.css';

import { createMap, LA_CALERA } from '../utils/map.js';
import { toggleSheet, setMode, showStatus, isSheetMinimized } from './ui.js';
import { onInput, showLocationSugg, setupSuggestionDismiss } from './geocoding.js';
import { placeMarker, clearPoint, checkRoute } from './routing.js';
import { acceptRide, cancelRide, stopListening } from './ride.js';
import { supabase } from '../config/supabase.js';
import { sanitizeHTML } from '../utils/security.js';

let passengerCaptchaAnswer = 0;
const PASSENGER_MAX_ATTEMPTS = 3;
const PASSENGER_LOCK_MS = 60000; // 60s

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
  isLocked: false,     // Bloquea interacción tras elegir destino
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
        document.getElementById('displayClientName').textContent = sanitizeHTML(nombre, 50);
        document.getElementById('displayClientPhone').textContent = sanitizeHTML(telefono, 20);
    }
  }
}

function setAuthMode(mode) {
  const btn = document.getElementById('savePassengerAuthBtn');
  const switchBtn = document.getElementById('authSwitchBtn');
  const switchText = document.getElementById('authSwitchText');
  
  const groupNombre = document.getElementById('groupNombre');
  const groupCedula = document.getElementById('groupCedula');
  const groupTelefono = document.getElementById('groupTelefono');
  const backBtn = document.getElementById('authBackBtn');

  if (mode === 'register') {
    btn.textContent = 'Registrarme y Entrar';
    switchBtn.textContent = '¡Ya tengo cuenta!';
    switchText.textContent = '¿Ya eres usuario?';
    
    if(groupNombre) groupNombre.style.display = 'block';
    if(groupCedula) groupCedula.style.display = 'block';
    if(groupTelefono) groupTelefono.style.display = 'block';
    if(backBtn) backBtn.style.display = 'flex';
  } else {
    btn.textContent = 'Ingresar';
    switchBtn.textContent = '¡Registrarme!';
    switchText.textContent = '¿No tienes cuenta?';
    
    if(groupNombre) groupNombre.style.display = 'none';
    if(groupCedula) groupCedula.style.display = 'block';
    if(groupTelefono) groupTelefono.style.display = 'block';
    // En login simple (solo cedula/tel), mostramos el atrás para cerrar si se desea.
    if(backBtn) backBtn.style.display = 'flex'; 
  }
}

function generatePassengerCaptcha() {
  const n1 = Math.floor(Math.random() * 9) + 1;
  const n2 = Math.floor(Math.random() * 9) + 1;
  passengerCaptchaAnswer = n1 + n2;
  const el = document.getElementById('passengerCaptchaQuestion');
  if (el) el.textContent = `${n1} + ${n2} =`;
  const input = document.getElementById('passengerCaptcha');
  if (input) input.value = '';
}

document.addEventListener('DOMContentLoaded', () => {
  // Verificar auth una vez que el DOM esté listo
  checkPassengerAuth();
  generatePassengerCaptcha();

  const btn = document.getElementById('savePassengerAuthBtn');
  const errorEl = document.getElementById('passengerAuthError');

  if (btn) {
    // ── Lógica de Bloqueo ──
    function checkBlockState() {
      const blockUntil = parseInt(sessionStorage.getItem('passenger_block_until') || '0');
      if (Date.now() < blockUntil) {
        const remaining = Math.ceil((blockUntil - Date.now()) / 1000);
        btn.disabled = true;
        btn.textContent = `Bloqueado (${remaining}s)`;
        if (errorEl) errorEl.textContent = 'Demasiados intentos. Espera un momento.';
        return true;
      }
      return false;
    }

    if (checkBlockState()) {
      const timer = setInterval(() => {
        if (!checkBlockState()) {
          clearInterval(timer);
          btn.disabled = false;
          btn.textContent = 'Ingresar';
          if (errorEl) errorEl.textContent = '';
          sessionStorage.removeItem('passenger_attempts');
        }
      }, 1000);
    }

    btn.addEventListener('click', async () => {
      if (checkBlockState()) return;

      const n = sanitizeHTML(document.getElementById('authNombre').value);
      const c = sanitizeHTML(document.getElementById('authCedula').value, 12);
      const t = sanitizeHTML(document.getElementById('authTelefono').value, 12);
      const captcha = parseInt(document.getElementById('passengerCaptcha').value);
      const terms = document.getElementById('authTerms').checked;

      // Validar Captcha Primero
      if (isNaN(captcha) || captcha !== passengerCaptchaAnswer) {
        let attempts = (parseInt(sessionStorage.getItem('passenger_attempts') || '0')) + 1;
        sessionStorage.setItem('passenger_attempts', attempts);
        
        if (attempts >= PASSENGER_MAX_ATTEMPTS) {
          const until = Date.now() + PASSENGER_LOCK_MS;
          sessionStorage.setItem('passenger_block_until', until);
          checkBlockState(); // Activar bloqueo inmediato
        } else {
          alert('Suma de seguridad incorrecta.');
          generatePassengerCaptcha();
        }
        return;
      }

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
        
        // Limpiar intentos al tener éxito
        sessionStorage.removeItem('passenger_attempts');

        document.getElementById('passengerAuthOverlay').style.display = 'none';
        checkPassengerAuth();
      } catch (err) {
        alert('Hubo un error al conectar con el servidor. Inténtalo de nuevo.');
        console.error('Auth error:', err);
      } finally {
        if (!checkBlockState()) {
            btn.disabled = false;
            btn.textContent = originalText;
        }
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

  const backBtn = document.getElementById('authBackBtn');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      const isRegister = document.getElementById('savePassengerAuthBtn').textContent.includes('Registrarme');
      if (isRegister) {
        setAuthMode('login');
      } else {
        // En login, el "Atrás" cierra el overlay (para ver el mapa)
        document.getElementById('passengerAuthOverlay').style.display = 'none';
      }
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
      logoutBtn.addEventListener('click', (e) => {
          e.stopPropagation(); // Evitar conflictos de clics
          if(confirm('¿Estás seguro de que quieres cerrar sesión?')) {
              // Limpieza total agresiva
              localStorage.clear(); 
              sessionStorage.clear();
              // Redirección forzada para limpiar memoria del navegador
              window.location.href = window.location.origin + window.location.pathname + '?v=' + Date.now();
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
  state.isLocked = false;
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
  if (state.isLocked) return; // No permitir clics si está bloqueado

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
    state.isLocked = true; // Bloquear tras seleccionar el destino
    // La tarifa y la línea naranja aparecen solas — no mostrar texto de calculando
    const hint = document.getElementById('clickHint');
    if (hint) hint.textContent = '📍 Ruta fijada. Usa "Reiniciar" para cambiar.';
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

// Rating logic removed by user request.
// Suggestion dismiss on outside click
setupSuggestionDismiss();

// ── Register Service Worker (PWA) ──
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register(new URL('/sw.js', import.meta.url).href).catch(console.log);
}
