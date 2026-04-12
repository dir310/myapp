/**
 * User page entry point — wires all modules together. build:20260406-v8
 */
import '../styles/common.css';
import '../styles/user.css';

import { createMap, LA_CALERA } from '../utils/map.js';
import { toggleSheet, setMode, showStatus, isSheetMinimized } from './ui.js';
import { onInput, showLocationSugg, setupSuggestionDismiss } from './geocoding.js';
import { placeMarker, clearPoint, checkRoute } from './routing.js';
import { acceptRide, cancelRide, stopListening, restoreActiveRide } from './ride.js';
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
  const email = localStorage.getItem('calmovil_cliente_email');
  const overlay = document.getElementById('passengerAuthOverlay');
  const profileWidget = document.getElementById('passengerProfileDisplay');

  if (!email) {
    if (overlay) {
      overlay.style.display = 'flex';
      setAuthMode('login');
    }
    if (profileWidget) profileWidget.style.display = 'none';
  } else {
    if (overlay) overlay.style.display = 'none';
    if (profileWidget) {
        profileWidget.style.display = 'flex';
        const nombre = localStorage.getItem('calmovil_cliente_nombre') || 'Cliente';
        const telefono = localStorage.getItem('calmovil_cliente_telefono') || '-';
        document.getElementById('displayClientName').textContent = sanitizeHTML(nombre, 50);
        document.getElementById('displayClientPhone').textContent = sanitizeHTML(telefono, 20);

        // Fetch Total Trips count
        supabase
          .from('viajes')
          .select('id', { count: 'exact', head: true })
          .eq('cliente_telefono', telefono)
          .eq('estado', 'finalizado')
          .then(({ count, error }) => {
            if (!error && count !== null) {
              let countEl = document.getElementById('displayClientTrips');
              if (countEl) {
                countEl.innerHTML = `🎯 <b>${count}</b> Viajes Totales`;
                countEl.style.display = 'block';
              } else {
                 const phoneEl = document.getElementById('displayClientPhone');
                 if (phoneEl) {
                   const span = document.createElement('span');
                   span.id = 'displayClientTrips';
                   span.innerHTML = `🎯 <b>${count}</b> Viajes Totales`;
                   span.style.cssText = 'display:block; margin-top:5px; font-size:11px; color:#30D158; text-transform:uppercase; font-weight:bold; background:rgba(48,209,88,.1); padding:2px 6px; border-radius:4px; max-width:fit-content; border:1px solid rgba(48,209,88,.2);';
                   phoneEl.parentNode.appendChild(span);
                 }
              }
            }
          });
    }
  }
}

function setAuthMode(mode) {
  const btn = document.getElementById('savePassengerAuthBtn');
  const switchBtn = document.getElementById('authSwitchBtn');
  const switchText = document.getElementById('authSwitchText');
  
  const groupEmail = document.getElementById('groupEmail');
  const groupPassword = document.getElementById('groupPassword');
  const groupNombre = document.getElementById('groupNombre');
  const groupCedula = document.getElementById('groupCedula');
  const groupTelefono = document.getElementById('groupTelefono');
  const captchaCont = document.getElementById('passengerCaptchaContainer');
  const termsLabel = document.getElementById('authTerms').closest('label');
  const backBtn = document.getElementById('authBackBtn');

  if (mode === 'register') {
    btn.textContent = 'Registrarme y Entrar';
    switchBtn.textContent = '¡Ya tengo cuenta!';
    switchText.textContent = '¿Ya eres usuario?';
    
    if(groupEmail) groupEmail.style.display = 'block';
    if(groupPassword) groupPassword.style.display = 'block';
    if(groupNombre) groupNombre.style.display = 'block';
    if(groupCedula) groupCedula.style.display = 'block';
    if(groupTelefono) groupTelefono.style.display = 'block';
    if(captchaCont) captchaCont.style.display = 'block';
    if(termsLabel) termsLabel.style.display = 'flex';
    if(backBtn) backBtn.style.display = 'flex';
  } else {
    btn.textContent = 'Ingresar';
    switchBtn.textContent = '¡Registrarme!';
    switchText.textContent = '¿No tienes cuenta?';
    
    if(groupEmail) groupEmail.style.display = 'block';
    if(groupPassword) groupPassword.style.display = 'block';
    if(groupNombre) groupNombre.style.display = 'none';
    if(groupCedula) groupCedula.style.display = 'none';
    if(groupTelefono) groupTelefono.style.display = 'none';
    if(captchaCont) captchaCont.style.display = 'none';
    if(termsLabel) termsLabel.style.display = 'none';
    if(backBtn) backBtn.style.display = 'none'; 
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

window.togglePassword = function(inputId, iconElement) {
  const input = document.getElementById(inputId);
  if (input.type === 'password') {
    input.type = 'text';
    iconElement.style.filter = 'grayscale(0)'; // Color completo
    iconElement.style.opacity = '1';
  } else {
    input.type = 'password';
    iconElement.style.filter = 'grayscale(1)'; // Blanco y negro / tenue
    iconElement.style.opacity = '0.6';
  }
};

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

      // ── Modo Edición: solo actualiza nombre y teléfono ──
      if (btn.textContent === 'Guardar Cambios') {
        const n = sanitizeHTML(document.getElementById('authNombre').value);
        const t = sanitizeHTML(document.getElementById('authTelefono').value, 12);
        const storedEmail = localStorage.getItem('calmovil_cliente_email');
        if (!n || !t) return alert('Por favor llena nombre y teléfono.');
        btn.disabled = true;
        btn.textContent = 'Guardando...';
        try {
          const { error } = await supabase
            .from('clientes')
            .update({ nombre: n, telefono: t })
            .eq('email', storedEmail);
          if (error) throw error;
          localStorage.setItem('calmovil_cliente_nombre', n);
          localStorage.setItem('calmovil_cliente_telefono', t);
          window.location.reload();
        } catch (err) {
          alert('Error al guardar: ' + (err.message || 'Inténtalo de nuevo.'));
          btn.disabled = false;
          btn.textContent = 'Guardar Cambios';
        }
        return;
      }

      const email = document.getElementById('authEmail').value.trim();
      const password = document.getElementById('authPassword').value;
      const isRegister = btn.textContent.includes('Registrar');

      if (!email || !password) return alert('Por favor llena el correo y la clave.');

      if (isRegister) {
        const n = sanitizeHTML(document.getElementById('authNombre').value);
        const c = sanitizeHTML(document.getElementById('authCedula').value, 12);
        const t = sanitizeHTML(document.getElementById('authTelefono').value, 12);
        const captcha = parseInt(document.getElementById('passengerCaptcha').value);
        const terms = document.getElementById('authTerms').checked;

        if (isNaN(captcha) || captcha !== passengerCaptchaAnswer) {
          alert('Suma de seguridad incorrecta.');
          generatePassengerCaptcha();
          return;
        }

        if (!n || !c || !t) return alert('Por favor llena todos los campos del registro.');
        if (!terms) return alert('Debes marcar la casilla aceptando los términos.');

        btn.disabled = true;
        btn.textContent = 'Creando cuenta...';

        try {
          const { data: insertedData, error: dbError } = await supabase
            .from('clientes')
            .insert([{
              nombre: n,
              cedula: c,
              telefono: t,
              email: email,
              password: password
            }])
            .select()
            .single();

          if (dbError) throw dbError;

          localStorage.setItem('calmovil_cliente_nombre', n);
          localStorage.setItem('calmovil_cliente_cedula', c);
          localStorage.setItem('calmovil_cliente_telefono', t);
          localStorage.setItem('calmovil_cliente_email', email);
          if (insertedData && insertedData.id) localStorage.setItem('calmovil_cliente_id', insertedData.id);
          
          window.location.reload();
        } catch (err) {
          alert('Error al registrar: ' + (err.message || 'Inténtalo de nuevo.'));
          btn.disabled = false;
          btn.textContent = 'Registrarme y Entrar';
        }
      } else {
        // MODO LOGIN
        btn.disabled = true;
        btn.textContent = 'Validando...';

        try {
          const { data, error } = await supabase
            .from('clientes')
            .select('*')
            .eq('email', email)
            .eq('password', password)
            .single();

          if (error || !data) {
            let attempts = (parseInt(sessionStorage.getItem('passenger_attempts') || '0')) + 1;
            sessionStorage.setItem('passenger_attempts', attempts);
            
            if (attempts >= PASSENGER_MAX_ATTEMPTS) {
              const until = Date.now() + PASSENGER_LOCK_MS;
              sessionStorage.setItem('passenger_block_until', until);
              checkBlockState();
            } else {
              alert('Correo o clave incorrectos.');
            }
            btn.disabled = false;
            btn.textContent = 'Ingresar';
            return;
          }

          localStorage.setItem('calmovil_cliente_nombre', data.nombre);
          localStorage.setItem('calmovil_cliente_cedula', data.cedula);
          localStorage.setItem('calmovil_cliente_telefono', data.telefono);
          localStorage.setItem('calmovil_cliente_email', data.email);
          if (data.id) localStorage.setItem('calmovil_cliente_id', data.id);
          
          window.location.reload();
        } catch (err) {
          alert('Error al ingresar: ' + err.message);
          btn.disabled = false;
          btn.textContent = 'Ingresar';
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
      // Siempre vuelve al modo Login
      setAuthMode('login');
    });
  }

  // ── Registration Form Handlers ──
  const editBtn = document.getElementById('editPassengerBtn');
  if (editBtn) {
      editBtn.addEventListener('click', () => {
          // Bloqueo si hay un viaje activo
          if (state.currentRideId) {
            alert('⚠️ No puedes editar tu perfil mientras tienes un viaje solicitado o en curso.');
            return;
          }

          // Pre-llenar solo nombre y teléfono
          document.getElementById('authNombre').value = localStorage.getItem('calmovil_cliente_nombre') || '';
          document.getElementById('authTelefono').value = localStorage.getItem('calmovil_cliente_telefono') || '';

          // Mostrar el overlay
          document.getElementById('passengerAuthOverlay').style.display = 'flex';

          // Ocultar campos que no aplican en edición
          ['groupEmail', 'groupPassword', 'groupCedula', 'passengerCaptchaContainer'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
          });
          // Ocultar términos
          const termsLabel = document.getElementById('authTerms')?.closest('label');
          if (termsLabel) termsLabel.style.display = 'none';
          // Ocultar enlace "¿No tienes cuenta? / Registrarme aquí"
          const switchDiv = document.getElementById('authSwitchBtn')?.closest('div');
          if (switchDiv) switchDiv.style.display = 'none';
          // Ocultar botón Atrás
          const backBtn = document.getElementById('authBackBtn');
          if (backBtn) backBtn.style.display = 'none';

          // Mostrar solo nombre y teléfono
          ['groupNombre', 'groupTelefono'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'block';
          });

          const saveBtn = document.getElementById('savePassengerAuthBtn');
          if (saveBtn) saveBtn.textContent = 'Guardar Cambios';
      });
  }

  const logoutBtn = document.getElementById('logoutPassengerBtn');
  if (logoutBtn) {
      logoutBtn.addEventListener('click', (e) => {
          e.stopPropagation(); // Evitar conflictos de clics

          // Bloqueo si hay un viaje activo
          if (state.currentRideId) {
            alert('⚠️ No puedes cerrar sesión mientras tienes un viaje solicitado o en curso.');
            return;
          }

          if(confirm('¿Estás seguro de que quieres cerrar sesión?')) {
              // Limpieza total agresiva
              localStorage.clear(); 
              sessionStorage.clear();
              // Redirección forzada para limpiar memoria del navegador
              window.location.href = window.location.origin + window.location.pathname + '?v=' + Date.now();
          }
      });
  }

  // ── Modal Acerca de ZIPPY ──
  const openAboutBtn = document.getElementById('openAboutBtn');
  const aboutZippyOverlay = document.getElementById('aboutZippyOverlay');
  const closeAboutBtn = document.getElementById('closeAboutBtn');

  if (openAboutBtn) {
    openAboutBtn.addEventListener('click', () => {
      if (aboutZippyOverlay) aboutZippyOverlay.style.display = 'flex';
      // Mover el zIindex de leaflet si es necesario para evitar solapamientos visuales extraños
    });
  }

  if (closeAboutBtn) {
    closeAboutBtn.addEventListener('click', () => {
      if (aboutZippyOverlay) aboutZippyOverlay.style.display = 'none';
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
  if (state.currentRideId) {
    alert('⚠️ No puedes reiniciar el mapa mientras tienes un viaje en progreso.');
    return;
  }
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
  navigator.serviceWorker.register(new URL('/sw.js', import.meta.url).href, { scope: '/' }).catch(console.log);
}

// ── Restaurar viaje activo si existe ──
restoreActiveRide(state, map);

// ── Pre-warming Supabase (Cold Start Fix) ──
// Lanza una pequeña consulta para despertar la DB mientras el usuario elige ruta.
supabase.from('clientes').select('id').limit(1).then(() => console.log('⚡ DB Wake-up ping sent.'));
