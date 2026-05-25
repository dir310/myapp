/**
 * User page entry point — wires all modules together. build:20260423-v2
 */
import '../styles/common.css';
import '../styles/user.css';

import { createMap, LA_CALERA } from '../utils/map.js';
import { toggleSheet, setMode, showStatus, isSheetMinimized, updateGuidance, initSwipeGestures } from './ui.js';
import { onInput, showLocationSugg, setupSuggestionDismiss, useCurrentLocation } from './geocoding.js';
import { placeMarker, clearPoint, checkRoute } from './routing.js';
import { acceptRide, cancelRide, stopListening, restoreActiveRide } from './ride.js';
import { supabase } from '../config/supabase.js';
import { sanitizeHTML } from '../utils/security.js';
import { zippyAlert, zippyConfirm, zippyToast, zippyDanger } from '../utils/ui-global.js';
import { compressImage } from '../utils/image.js';

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
  mode: 'click',
  nextClick: 'start',
  currentRideId: null,
  pollerInterval: null,
  isLocked: false,        // Bloquea interacción tras elegir destino
  mapClickTarget: null,   // 'start' | 'end' | null — solo activo cuando el usuario eligió "Tocar en el mapa"
  mapClickProcessing: false, // Anti-doble-tap: bloquea un segundo clic simultáneo
};

// ── Reloj del Perfil ──
function iniciarRelojPerfil() {
  const greetingEl = document.getElementById('profileGreeting');
  const dateEl = document.getElementById('profileDate');
  const timeEl = document.getElementById('profileTime');
  if (!greetingEl || !dateEl || !timeEl) return;

  function updateClock() {
    const now = new Date();
    const hours = now.getHours();
    
    // Saludo
    let saludo = '¡Buenas Noches! 🌙';
    if (hours >= 5 && hours < 12) saludo = '¡Buenos Días! ☀️';
    else if (hours >= 12 && hours < 19) saludo = '¡Buenas Tardes! ⛅';
    greetingEl.textContent = saludo;

    // Fecha
    const opcionesFecha = { day: 'numeric', month: 'long', year: 'numeric' };
    dateEl.textContent = now.toLocaleDateString('es-CO', opcionesFecha);

    // Hora
    let h = hours % 12;
    h = h ? h : 12; // la hora 0 debe ser 12
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const m = now.getMinutes().toString().padStart(2, '0');
    timeEl.innerHTML = `${h}:${m} <span style="font-size:10px; color:rgba(255,255,255,0.4);">${ampm}</span>`;
  }

  updateClock();
  setInterval(updateClock, 60000); // Actualizar cada minuto
}

// ── Historial de Viajes (Pasajero) ──
async function loadPassengerHistory() {
  const modal = document.getElementById('passengerHistoryModal');
  const container = document.getElementById('historyListContainer');
  if (!modal || !container) return;

  modal.style.display = 'flex';
  container.innerHTML = `
    <div style="text-align:center;padding:40px 20px;color:rgba(255,255,255,0.5);font-size:14px;">
        <span class="spinner" style="display:inline-block;border-width:3px;height:24px;width:24px;margin-bottom:15px;border-top-color:#FF6B00;"></span><br>
        Cargando tus viajes...
    </div>
  `;

  const telefono = localStorage.getItem('calmovil_cliente_telefono');
  if (!telefono) {
    container.innerHTML = `<div style="text-align:center;padding:40px 20px;color:#FF3B30;">Error: No se encontró tu número de teléfono.</div>`;
    return;
  }

  const { data, error } = await supabase
    .from('viajes')
    .select('id, created_at, codigo_viaje, conductor_id, tarifa, estado')
    .eq('cliente_telefono', telefono)
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    container.innerHTML = `<div style="text-align:center;padding:40px 20px;color:#FF3B30;">Error al cargar el historial. Intenta más tarde.</div>`;
    return;
  }

  if (!data || data.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:50px 20px;">
        <div style="font-size:50px;margin-bottom:15px;opacity:0.5;">👻</div>
        <h4 style="color:#fff;margin-bottom:5px;">Aún no tienes viajes</h4>
        <p style="color:rgba(255,255,255,0.5);font-size:13px;">Tus próximos viajes aparecerán aquí.</p>
      </div>
    `;
    return;
  }

  const driverIds = [...new Set(data.map(v => v.conductor_id).filter(id => id))];
  let driverNames = {};
  if (driverIds.length > 0) {
      const { data: driversData } = await supabase.from('conductores').select('id, nombre').in('id', driverIds);
      if (driversData) {
          driversData.forEach(d => driverNames[d.id] = d.nombre);
      }
  }

  let html = '';
  data.forEach(v => {
    const isCompleted = v.estado === 'finalizado';
    const isCanceled = v.estado === 'cancelado';
    
    let icon = '🔄';
    let iconColor = '#FFB347';
    let statusText = 'En curso';
    
    if (isCompleted) {
        icon = '✅'; iconColor = '#30D158'; statusText = 'Completado';
    } else if (isCanceled) {
        icon = '🚫'; iconColor = '#FF3B30'; statusText = 'Cancelado';
    }

    const dateObj = new Date(v.created_at);
    const dateStr = dateObj.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });
    const timeStr = dateObj.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: true });

    const dName = driverNames[v.conductor_id] || (v.estado === 'buscando' ? 'Buscando...' : 'Desconocido');

    html += `
      <div style="background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); border-radius:16px; padding:15px; display:flex; justify-content:space-between; align-items:center;">
          <div style="display:flex; align-items:center; gap:12px;">
              <div style="width:40px; height:40px; border-radius:50%; background:rgba(255,255,255,0.05); display:flex; align-items:center; justify-content:center; font-size:18px; border:1px solid ${iconColor}40;">
                  ${icon}
              </div>
              <div>
                  <div style="color:#fff; font-weight:800; font-size:14px; margin-bottom:2px;">${dateStr}, ${timeStr}</div>
                  <div style="color:rgba(255,255,255,0.5); font-size:12px; margin-bottom:2px;">🏎️ ${dName}</div>
                  <div style="color:${iconColor}; font-size:10px; font-weight:700; text-transform:uppercase;">${statusText}</div>
              </div>
          </div>
          <div style="text-align:right;">
              <div style="color:#FF6B00; font-weight:900; font-size:11px; margin-bottom:4px;">#${v.codigo_viaje || 'ZIPPY'}</div>
              <div style="color:#fff; font-weight:900; font-size:18px;">$${v.tarifa ? v.tarifa.toLocaleString('es-CO') : '0'}</div>
          </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

setTimeout(() => {
    document.getElementById('historyPassengerBtn')?.addEventListener('click', loadPassengerHistory);
    document.getElementById('closeHistoryBtn')?.addEventListener('click', () => {
        document.getElementById('passengerHistoryModal').style.display = 'none';
    });
}, 1000);

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
        iniciarRelojPerfil();
        
        const nombre = localStorage.getItem('calmovil_cliente_nombre') || 'Cliente';
        const telefono = localStorage.getItem('calmovil_cliente_telefono') || '-';
        document.getElementById('displayClientName').textContent = sanitizeHTML(nombre, 50);
        document.getElementById('displayClientPhone').textContent = sanitizeHTML(telefono, 20);

        // --- Lógica de Foto de Perfil (Avatar) ---
        const avatarImg = document.getElementById('profileAvatarImg');
        const avatarEmoji = document.getElementById('profileAvatarEmoji');
        const uploadBtn = document.getElementById('uploadAvatarBtn');
        const fileInput = document.getElementById('avatarFileInput');

        // Función para actualizar UI del avatar
        const updateAvatarUI = (url) => {
            if (url && url.trim() !== '') {
                avatarImg.src = url;
                avatarImg.style.display = 'block';
                avatarEmoji.style.display = 'none';
                localStorage.setItem('zippy_passenger_avatar', url);
            } else {
                avatarImg.style.display = 'none';
                avatarEmoji.style.display = 'block';
            }
        };

        // Cargar foto inicial desde local
        updateAvatarUI(localStorage.getItem('zippy_passenger_avatar'));

        // Configurar subida de foto
        if (uploadBtn && fileInput && !fileInput.dataset.bound) {
            fileInput.dataset.bound = 'true';
            uploadBtn.addEventListener('click', () => fileInput.click());
            
            fileInput.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if (!file) return;

                const clienteId = localStorage.getItem('calmovil_cliente_id');
                if (!clienteId) return zippyAlert('Inicia sesión de nuevo para cambiar tu foto.');

                const originalHtml = uploadBtn.innerHTML;
                uploadBtn.innerHTML = '<div class="spinner" style="width:12px;height:12px;border-width:2px;border-top-color:#FF6B00;border-color:rgba(255,107,0,0.2);"></div>';
                uploadBtn.style.pointerEvents = 'none';

                try {
                    // Comprimir
                    const compressed = await compressImage(file, 400); // Max 400px de ancho/alto
                    const fileName = `${clienteId}-${Date.now()}.jpg`;

                    // Subir a Supabase
                    const { error: uploadError } = await supabase.storage.from('avatars').upload(`passengers/${fileName}`, compressed, { upsert: true });
                    if (uploadError) throw uploadError;

                    // Obtener URL pública
                    const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(`passengers/${fileName}`);

                    // Guardar en base de datos
                    const { error: dbError } = await supabase.from('clientes').update({ foto_url: publicUrl }).eq('id', clienteId);
                    if (dbError) throw dbError;

                    // Actualizar UI
                    updateAvatarUI(publicUrl);
                    zippyToast('📸 ¡Foto de perfil actualizada!');

                } catch (err) {
                    console.error('Error subiendo avatar:', err);
                    zippyAlert('❌ Hubo un error al subir tu foto. Inténtalo de nuevo.');
                } finally {
                    uploadBtn.innerHTML = originalHtml;
                    uploadBtn.style.pointerEvents = 'auto';
                    fileInput.value = '';
                }
            });
        }

        // --- Verificación de Aprobación Administrativa ---
        const emailStored = localStorage.getItem('calmovil_cliente_email');
        const clienteId = localStorage.getItem('calmovil_cliente_id');

        // Configurar Escucha (Listener) para Calificación del Conductor
        if (clienteId && !state.ratingListenerActive) {
          state.ratingListenerActive = true;
          supabase.channel('mis-viajes-updates')
            .on('postgres_changes', {
              event: 'UPDATE',
              schema: 'public',
              table: 'viajes',
              filter: `pasajero_id=eq.${clienteId}`
            }, (payload) => {
              if (payload.new.calificacion_cliente && payload.new.calificacion_cliente > 0) {
                const notified = JSON.parse(localStorage.getItem('zippy_notified_ratings') || '[]');
                if (!notified.includes(payload.new.id)) {
                  zippyToast(`¡El conductor te calificó con ${payload.new.calificacion_cliente} estrellas! ⭐`);
                  notified.push(payload.new.id);
                  localStorage.setItem('zippy_notified_ratings', JSON.stringify(notified));
                }
              }
            }).subscribe();
        }

        supabase
          .from('clientes')
          .select('estado_validacion, saldo_bono, multa_pendiente, foto_url')
          .eq('email', emailStored)
          .single()
          .then(({ data, error }) => {
            const banner = document.getElementById('passengerValidationBanner');
            const topSearch = document.getElementById('topSearchArea');
            if (!error && data) {
              // Sincronizar foto de perfil si viene de la nube
              if (data.foto_url) updateAvatarUI(data.foto_url);
              
              // Actualizar saldo bono y multa
              window.zippyCurrentBono = data.saldo_bono || 0;
              window.zippyCurrentMulta = data.multa_pendiente || 0;
              let bonoEl = document.getElementById('displayClientBono');
              let bonoTextEl = document.getElementById('availableBonoText');
              if (bonoEl) bonoEl.textContent = '$' + window.zippyCurrentBono.toLocaleString('es-CO');
              if (bonoTextEl) bonoTextEl.textContent = '$' + window.zippyCurrentBono.toLocaleString('es-CO');
              
              localStorage.setItem('zippy_passenger_status', data.estado_validacion);
              if (data.estado_validacion === 'pendiente') {
                if (banner) banner.style.display = 'block';
                if (topSearch) {
                  topSearch.style.pointerEvents = 'none';
                  topSearch.style.opacity = '0.4';
                }
              } else {
                if (banner) banner.style.display = 'none';
                if (topSearch) {
                  topSearch.style.pointerEvents = 'auto';
                  topSearch.style.opacity = '1';
                }
                
                // Iniciar tour si nunca lo ha visto y el manual no está abierto
                const safetyModal = document.getElementById('passengerSafetyModal');
                const isSafetyModalOpen = safetyModal && safetyModal.style.display !== 'none';
                
                const tourVisto = localStorage.getItem('zippy_tour_completed');
                if (tourVisto !== 'true' && !isSafetyModalOpen) {
                    setTimeout(iniciarTourPasajero, 1000); // Esperar a que cargue la UI
                }
              }
            }
          });

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
                countEl.textContent = count;
                countEl.style.display = 'block';
              }
            }
          });
        
        // --- Trigger Safety Modal (Solo una vez por sesión) ---
        if (!localStorage.getItem('zippy_passenger_safety_shown')) {
          const safetyModal = document.getElementById('passengerSafetyModal');
          if (safetyModal) safetyModal.style.display = 'flex';
        }
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
  const groupEdad = document.getElementById('groupEdad');
  const groupFotoFrontal = document.getElementById('groupFotoFrontal');
  const groupFotoTrasera = document.getElementById('groupFotoTrasera');
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
    if(groupEdad) groupEdad.style.display = 'block';
    if(groupFotoFrontal) groupFotoFrontal.style.display = 'block';
    if(groupFotoTrasera) groupFotoTrasera.style.display = 'block';
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
    if(groupEdad) groupEdad.style.display = 'none';
    if(groupFotoFrontal) groupFotoFrontal.style.display = 'none';
    if(groupFotoTrasera) groupFotoTrasera.style.display = 'none';
    if(captchaCont) captchaCont.style.display = 'block'; // Captcha obligatorio también en login
    if(termsLabel) termsLabel.style.display = 'flex';
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

  // Re-verificar auth si el usuario vuelve usando el botón de Atrás del navegador (bfcache)
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) {
      checkPassengerAuth();
    }
  });

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
      const authMode = btn.textContent === 'Guardar Cambios' ? 'edit' : (btn.textContent.includes('Registrar') ? 'register' : 'login');

      // ── Modo Edición: solo actualiza nombre y teléfono ──
      if (authMode === 'edit') {
        const n = sanitizeHTML(document.getElementById('authNombre').value.trim(), 60);
        const t = sanitizeHTML(document.getElementById('authTelefono').value.trim(), 10);

        if (!n || !t) return zippyAlert('Por favor llena nombre y teléfono.', '⚠️');

        btn.innerHTML = '<span class="spinner"></span> Guardando...';
        btn.disabled = true;

        try {
          const { error: err } = await supabase
            .from('clientes')
            .update({ nombre: n, telefono: t })
            .eq('id', localStorage.getItem('calmovil_cliente_id'));

          if (err) throw err;

          localStorage.setItem('calmovil_cliente_nombre', n);
          localStorage.setItem('calmovil_cliente_telefono', t);

          await zippyAlert('¡Perfil actualizado con éxito!', '✨');
          location.reload();
        } catch (err) {
          zippyAlert('Error al guardar: ' + (err.message || 'Inténtalo de nuevo.'), '❌');
          btn.textContent = 'Guardar Cambios';
          btn.disabled = false;
        }
      } else {
        // ── MODO LOGIN / REGISTRO ──
        const email = document.getElementById('authEmail').value.trim();
        const password = document.getElementById('authPassword').value.trim();
        const terms = document.getElementById('authTerms').checked;
        const captcha = parseInt(document.getElementById('passengerCaptcha').value);

        if (!email || !password) return zippyAlert('Por favor llena el correo y la clave.', '📧');
        if (!terms) return zippyAlert('Debes marcar la casilla aceptando los términos y condiciones para continuar.', '🛡️');
        if (captcha !== passengerCaptchaAnswer) {
          zippyAlert('Suma de seguridad incorrecta. Inténtalo de nuevo.', '🧩');
          return;
        }

        if (authMode === 'login') {
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!emailRegex.test(email)) {
            return zippyAlert('⚠️ Por favor ingresa un correo electrónico válido (ejemplo@correo.com).', '📧');
          }

          btn.innerHTML = '<span class="spinner"></span> Ingresando...';
          btn.disabled = true;

          try {
            const { data, error: err } = await supabase
              .from('clientes')
              .select('*')
              .eq('email', email)
              .eq('password', password)
              .single();

            if (err || !data) {
                let attempts = (parseInt(sessionStorage.getItem('passenger_attempts') || '0')) + 1;
                sessionStorage.setItem('passenger_attempts', attempts);
                if (attempts >= PASSENGER_MAX_ATTEMPTS) {
                  sessionStorage.setItem('passenger_block_until', Date.now() + PASSENGER_LOCK_MS);
                }
                zippyAlert('Correo o clave incorrectos.', '❌');
                btn.textContent = 'Ingresar';
                btn.disabled = false;
                return;
            }

            localStorage.setItem('calmovil_cliente_id', data.id);
            localStorage.setItem('calmovil_cliente_nombre', data.nombre);
            localStorage.setItem('calmovil_cliente_email', data.email);
            localStorage.setItem('calmovil_cliente_telefono', data.telefono);
            localStorage.setItem('calmovil_cliente_cedula', data.cedula);
            localStorage.setItem('zippy_passenger_status', data.estado_validacion || 'activo');
            
            // Olvidar el tour para que se muestre en cada inicio de sesión
            localStorage.removeItem('zippy_tour_completed');

            await zippyAlert(`¡Hola, ${data.nombre}! Qué bueno verte.\nEstamos listos para llevarte rápido y seguro por La Calera. ¿A dónde vamos hoy?`, '🚗✨');
            location.reload();
          } catch (err) {
            zippyAlert('Error al ingresar: ' + err.message, '❌');
            btn.textContent = 'Ingresar';
            btn.disabled = false;
          }
        } else {
          // ── MODO REGISTRO ──
          const nombre = document.getElementById('authNombre').value.trim();
          const telefono = document.getElementById('authTelefono').value.trim();
          const cedula = document.getElementById('authCedula').value.trim();
          const edad = parseInt(document.getElementById('authEdad').value);

          const photoFront = document.getElementById('authFotoFrontal').files[0];
          const photoBack = document.getElementById('authFotoTrasera').files[0];

          if (!nombre || !telefono || !cedula || isNaN(edad) || !photoFront || !photoBack) {
            return zippyAlert('Por favor llena todos los campos, incluyendo tu edad y las fotos de tu cédula.', '📎');
          }

          const passRegex = /^(?=.*[a-z])(?=.*\d).{6,}$/;
          if (!passRegex.test(password)) {
            return zippyAlert('⚠️ Contraseña muy compleja o corta. Pon algo simple: 5 números y 1 letra minúscula (Ej: 12345a).', '🔑');
          }

          if (edad < 18) {
            return zippyAlert('❌ Registro denegado: Debes ser mayor de 18 años para usar ZIPPY.', '🔞');
          }

          btn.innerHTML = '<span class="spinner"></span> Preparando fotos...';
          btn.disabled = true;

          try {
            const compressedFront = await compressImage(photoFront);
            const compressedBack = await compressImage(photoBack);

            btn.innerHTML = '<span class="spinner"></span> Subiendo fotos...';

            const frontRef = `clientes/${Date.now()}_front.jpg`;
            const backRef = `clientes/${Date.now()}_back.jpg`;

            await supabase.storage.from('identificaciones').upload(frontRef, compressedFront);
            await supabase.storage.from('identificaciones').upload(backRef, compressedBack);

            btn.innerHTML = '<span class="spinner"></span> Creando cuenta...';

            const { data: newUser, error: err } = await supabase.from('clientes').insert([{
              nombre, email, password, telefono, cedula, edad,
              foto_frontal_url: frontRef, foto_trasera_url: backRef,
              estado_validacion: 'pendiente',
              saldo_bono: 3000
            }]).select().single();

            if (err) throw err;

            // Auto-login: guardar datos en memoria local para no volver al formulario
            window.zippyCurrentBono = 3000;
            localStorage.setItem('calmovil_cliente_id', newUser.id);
            localStorage.setItem('calmovil_cliente_nombre', newUser.nombre);
            localStorage.setItem('calmovil_cliente_email', newUser.email);
            localStorage.setItem('calmovil_cliente_telefono', newUser.telefono);
            localStorage.setItem('calmovil_cliente_cedula', newUser.cedula);
            localStorage.setItem('zippy_passenger_status', 'pendiente');
            
            // Olvidar el tour para que se muestre en este nuevo registro
            localStorage.removeItem('zippy_tour_completed');

            await zippyAlert('¡Registro exitoso! Por seguridad, un administrador validará tus datos en unos minutos. Te avisaremos pronto.', '✅');
            location.reload();
          } catch (err) {
            zippyAlert('Error al registrar: ' + (err.message || 'Inténtalo de nuevo.'), '❌');
            btn.textContent = 'Registrarme y Entrar';
            btn.disabled = false;
          }
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
      setAuthMode('login');
    });
  }

  // ── Registration Form Handlers ──
  const editBtn = document.getElementById('editPassengerBtn');
  if (editBtn) {
      editBtn.addEventListener('click', async () => {
          if (state.currentRideId) {
            await zippyAlert('⚠️ No puedes editar tu perfil mientras tienes un viaje solicitado o en curso.', '✋');
            return;
          }

          document.getElementById('authNombre').value = localStorage.getItem('calmovil_cliente_nombre') || '';
          document.getElementById('authTelefono').value = localStorage.getItem('calmovil_cliente_telefono') || '';

          // Mostrar el overlay
          document.getElementById('passengerAuthOverlay').style.display = 'flex';

          // Ocultar campos que no aplican en edición
          ['groupEmail', 'groupPassword', 'groupCedula', 'groupEdad', 'groupFotoFrontal', 'groupFotoTrasera', 'passengerCaptchaContainer'].forEach(id => {
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
      logoutBtn.addEventListener('click', async (e) => {
          e.stopPropagation(); // Evitar conflictos de clics

          // Bloqueo si hay un viaje activo
          if (state.currentRideId) {
            await zippyAlert('⚠️ No puedes cerrar sesión mientras tienes un viaje solicitado o en curso.', '✋');
            return;
          }

          if(await zippyConfirm('¿Estás seguro de que quieres cerrar sesión?', '🚪')) {
              // Limpieza total agresiva
              localStorage.clear(); 
              sessionStorage.clear();
              // Usamos replace para no generar un nuevo historial y evitar que el botón atrás regrese al mapa
              window.location.replace(window.location.origin + window.location.pathname);
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
  });
}

  if (closeAboutBtn) {
    closeAboutBtn.addEventListener('click', () => {
      if (aboutZippyOverlay) aboutZippyOverlay.style.display = 'none';
    });
  }

  // --- Botón cerrar Protocolo de Seguridad (Pasajero) ---
  const closePassengerSafetyBtn = document.getElementById('closePassengerSafetyBtn');
  if (closePassengerSafetyBtn) {
    closePassengerSafetyBtn.onclick = () => {
      // Reproducir sonido de "Zippy" al aceptar
      try {
          // Usamos MP3 porque Safari y algunos iPhones no soportan .ogg
          const zippySound = new Audio('https://www.soundjay.com/buttons/sounds/button-09.mp3');
          zippySound.volume = 0.5;
          zippySound.play().catch(e => console.log('Audio autoplay blocked', e));
      } catch (err) {}

      document.getElementById('passengerSafetyModal').style.display = 'none';
      localStorage.setItem('zippy_passenger_safety_shown', 'true');
      
      const status = localStorage.getItem('zippy_passenger_status');
      const tourVisto = localStorage.getItem('zippy_tour_completed');
      if (tourVisto !== 'true' && status !== 'pendiente') {
          setTimeout(iniciarTourPasajero, 500); 
      }
    };
  }
  // --- Botón Verificar Aprobación ---
  const checkApprovalBtn = document.getElementById('checkApprovalBtn');
  if (checkApprovalBtn) {
    checkApprovalBtn.addEventListener('click', async () => {
      checkApprovalBtn.textContent = '⏳ Revisando...';
      checkApprovalBtn.disabled = true;
      
      const emailStored = localStorage.getItem('calmovil_cliente_email');
      try {
        const { data, error } = await supabase
          .from('clientes')
          .select('estado_validacion')
          .eq('email', emailStored)
          .single();
          
        if (error) throw error;
        
        if (data.estado_validacion === 'pendiente') {
          zippyAlert('Aún estamos revisando tus datos. Vuelve a intentar en unos minuticos.', '⌛');
          checkApprovalBtn.textContent = '🔄 Verificar si ya fui aprobado';
          checkApprovalBtn.disabled = false;
        } else {
          localStorage.setItem('zippy_passenger_status', data.estado_validacion);
          await zippyAlert('¡Felicidades, tu cuenta ha sido aprobada! Ya puedes pedir viajes.', '🎉');
          location.reload();
        }
      } catch (err) {
        zippyAlert('Error al conectar. Verifica tu internet y vuelve a intentar.', '❌');
        checkApprovalBtn.textContent = '🔄 Verificar si ya fui aprobado';
        checkApprovalBtn.disabled = false;
      }
    });
  }
});
// ── Initialize Map ──
const map = createMap('map', LA_CALERA, 13);

// ── Bound Helpers (curried with state & map) ──
const boundPlaceMarker = (type, lat, lng, name) => placeMarker(type, lat, lng, name, state, map);
const boundClearPoint = (type) => clearPoint(type, state, map);

// ── El hint de mapa solo aparece cuando el usuario elige "Tocar en el mapa" ──
// (No se preactiva automáticamente al cargar)

// ── Event Listeners ──

// Sidebar tab toggle
document.getElementById('sidebarHeader').addEventListener('click', toggleSheet);
document.getElementById('openSidebarLink').addEventListener('click', toggleSheet);

// --- Inicializar Gestos (Swipe) ---
initSwipeGestures();

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
  state.mapClickTarget = null;
  state.mapClickProcessing = false;
  showStatus('', false);

  const hint = document.getElementById('clickHint');
  if (hint) { hint.style.display = 'none'; hint.textContent = ''; }

  const btn = document.getElementById('resetPointsBtn');
  btn.textContent = '✅ Reiniciando...';
  btn.style.color = 'rgba(48,209,88,0.8)';

  // Refresca la página después de un breve feedback visual
  setTimeout(() => window.location.reload(), 700);
});

// Confirm Route Button (Floating)
const confirmRouteBtn = document.getElementById('confirmRouteBtn');
if (confirmRouteBtn) {
  confirmRouteBtn.addEventListener('click', () => {
    toggleSheet();
    confirmRouteBtn.style.display = 'none';
  });
}

// Search inputs
document.getElementById('startInput').addEventListener('input', (e) => onInput(e.target, 'start', boundPlaceMarker, state));
document.getElementById('startInput').addEventListener('focus', () => {
  state.nextClick = 'start';
  showLocationSugg('start', boundPlaceMarker, state);
});

document.getElementById('endInput').addEventListener('input', (e) => onInput(e.target, 'end', boundPlaceMarker, state));
document.getElementById('endInput').addEventListener('focus', () => {
  state.nextClick = 'end';
  showLocationSugg('end', boundPlaceMarker, state);
});

// Clear buttons
document.querySelectorAll('.clear-btn').forEach((btn, i) => {
  const type = i === 0 ? 'start' : 'end';
  btn.addEventListener('click', () => boundClearPoint(type));
});

// ── Lugares Favoritos (Casa / Trabajo) ──
function initFavorites() {
  const types = ['Casa', 'Trabajo'];
  
  types.forEach(type => {
    const btn = document.getElementById(`fav${type}Btn`);
    if (!btn) return;
    
    // Configurar estilo si ya existe
    const storageKey = `zippy_fav_${type.toLowerCase()}`;
    if (localStorage.getItem(storageKey)) {
        btn.style.borderColor = 'rgba(48,209,88,0.4)';
        btn.style.color = '#30D158';
    }

    btn.addEventListener('click', () => {
      if (state.currentRideId) return zippyAlert('⚠️ No puedes usar favoritos durante un viaje activo.', '✋');
      
      const savedFav = localStorage.getItem(storageKey);
      if (savedFav) {
          // Usar el favorito guardado
          const favData = JSON.parse(savedFav);
          const target = state.nextClick || 'end'; // default to end si undefined
          boundPlaceMarker(target, favData.lat, favData.lng, favData.name);
          
          // Cambiar foco al otro input para agilizar
          state.nextClick = target === 'start' ? 'end' : 'start';
          const nextInput = document.getElementById(state.nextClick + 'Input');
          if (nextInput) {
            nextInput.focus();
            // close suggestions just in case
            const sugg = document.getElementById(state.nextClick + 'Suggestions');
            if(sugg) sugg.style.display = 'none';
          }
      } else {
          // Guardar nuevo favorito
          // Buscar si hay un punto seleccionado activo
          let activePoint = null;
          if (state.nextClick === 'start' && state.startMarker) activePoint = { lat: state.startLatLng.lat, lng: state.startLatLng.lng, name: document.getElementById('startInput').value || 'Ubicación seleccionada' };
          else if (state.nextClick === 'end' && state.endMarker) activePoint = { lat: state.endLatLng.lat, lng: state.endLatLng.lng, name: document.getElementById('endInput').value || 'Ubicación seleccionada' };
          else if (state.endMarker) activePoint = { lat: state.endLatLng.lat, lng: state.endLatLng.lng, name: document.getElementById('endInput').value || 'Ubicación seleccionada' };
          else if (state.startMarker) activePoint = { lat: state.startLatLng.lat, lng: state.startLatLng.lng, name: document.getElementById('startInput').value || 'Ubicación seleccionada' };

          if (!activePoint) {
              return zippyAlert(`Para configurar tu ${type}, primero busca tu dirección en el mapa o escríbela, y luego vuelve a presionar este botón.`, '📌');
          }

          zippyConfirm(`¿Quieres guardar "${activePoint.name}" como tu ${type}?`, '⭐').then(confirmed => {
              if (confirmed) {
                  localStorage.setItem(storageKey, JSON.stringify(activePoint));
                  btn.style.borderColor = 'rgba(48,209,88,0.4)';
                  btn.style.color = '#30D158';
                  zippyAlert(`¡${type} guardada con éxito!`, '✅');
              }
          });
      }
    });
  });

  const clearBtn = document.getElementById('favClearBtn');
  if (clearBtn) {
      clearBtn.addEventListener('click', () => {
          if (!localStorage.getItem('zippy_fav_casa') && !localStorage.getItem('zippy_fav_trabajo')) {
              return zippyAlert('No tienes lugares favoritos guardados aún.', 'ℹ️');
          }
          zippyConfirm('¿Estás seguro de que deseas borrar tus lugares favoritos (Casa y Trabajo)?', '🗑️').then(confirmed => {
              if (confirmed) {
                  localStorage.removeItem('zippy_fav_casa');
                  localStorage.removeItem('zippy_fav_trabajo');
                  
                  // Restaurar estilos originales
                  ['Casa', 'Trabajo'].forEach(t => {
                      const b = document.getElementById(`fav${t}Btn`);
                      if(b) {
                          b.style.borderColor = 'rgba(255,255,255,0.08)';
                          b.style.color = 'rgba(255,255,255,0.7)';
                      }
                  });
                  zippyAlert('Tus lugares favoritos han sido borrados.', '🧹');
              }
          });
      });
  }
}
initFavorites();

// Map click — solo activo cuando el usuario eligió explícitamente "Tocar en el mapa"
map.on('click', (e) => {
  if (state.isLocked) return;            // Ruta ya fijada
  if (!state.mapClickTarget) return;     // Nadie pidió un toque en el mapa → ignorar
  if (state.mapClickProcessing) return;  // Anti-doble-tap

  state.mapClickProcessing = true;
  const target = state.mapClickTarget;
  state.mapClickTarget = null; // Limpiar de inmediato: solo un punto por selección

  const hint = document.getElementById('clickHint');
  if (hint) { hint.style.display = 'none'; hint.textContent = ''; }

  const { lat, lng } = e.latlng;
  showStatus('📍 Cargando dirección...', true);

  // Colocar marcador instantáneo de cargando para cero latencia visual
  boundPlaceMarker(target, lat, lng, '📍 Cargando dirección...');

  // Intentamos convertir las coordenadas a dirección real con Nominatim en segundo plano
  fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`)
    .then(res => res.json())
    .then(data => {
      let name = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      if (data && data.address) {
        const addr = data.address;
        const road = addr.road || addr.pedestrian || addr.footway || '';
        const house = addr.house_number || '';
        const neighborhood = addr.neighbourhood || addr.suburb || addr.village || '';
        
        if (road) {
            name = house ? `${road} #${house}` : road;
            if (neighborhood) name += `, ${neighborhood}`;
        } else if (neighborhood) {
            name = neighborhood;
        } else if (data.display_name) {
            // Si no hay road, usar las primeras dos partes del display_name
            name = data.display_name.split(',').slice(0,2).join(',').trim();
        }
      }
      // Volver a llamar para actualizar el nombre real (solo si el punto sigue activo)
      if (target === 'start' && state.startLatLng) {
        boundPlaceMarker(target, lat, lng, name);
      } else if (target === 'end' && state.endLatLng) {
        boundPlaceMarker(target, lat, lng, name);
      }
    })
    .catch(err => {
      console.error('[ZIPPY] Error en Reverse Geocoding:', err);
      // Fallback a coordenadas si falla la red (solo si el punto sigue activo)
      const name = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      if (target === 'start' && state.startLatLng) {
        boundPlaceMarker(target, lat, lng, name);
      } else if (target === 'end' && state.endLatLng) {
        boundPlaceMarker(target, lat, lng, name);
      }
    })
    .finally(() => {
      showStatus('', false);
      setTimeout(() => { state.mapClickProcessing = false; }, 400);
    });
});

// Price section buttons — delegated since they're rebuilt dynamically
document.getElementById('priceSection').addEventListener('click', (e) => {
  const target = e.target.closest('button');
  if (!target) return;

  // ── Seleccionar método de pago ──
  if (target.id === 'payEfectivoBtn' || target.id === 'payWompiBtn') {
    const isWompi = target.id === 'payWompiBtn';
    state.selectedPaymentMethod = isWompi ? 'wompi' : 'efectivo';

    const btnW = document.getElementById('payWompiBtn');
    const btnE = document.getElementById('payEfectivoBtn');
    if (btnW && btnE) {
      // Resaltar seleccionado, atenuar el otro
      btnW.style.opacity   = isWompi ? '1' : '0.4';
      btnW.style.transform = isWompi ? 'scale(1.05)' : 'scale(1)';
      btnW.style.boxShadow = isWompi ? '0 0 0 2.5px #30D158' : 'none';
      btnW.innerHTML       = isWompi ? '✅ Wompi' : '💳 Wompi';

      btnE.style.opacity   = isWompi ? '0.4' : '1';
      btnE.style.transform = isWompi ? 'scale(1)' : 'scale(1.05)';
      btnE.style.boxShadow = isWompi ? 'none' : '0 0 0 2.5px rgba(255,255,255,.5)';
      btnE.innerHTML       = isWompi ? '💵 Efectivo' : '✅ Efectivo';
    }

    // Mostrar "Cambiar método"
    const changeRow = document.getElementById('changePaymentRow');
    if (changeRow) changeRow.style.display = 'block';

    // Habilitar "Pedir Viaje"
    const pedirBtn = document.getElementById('pedirViajeBtn');
    if (pedirBtn) {
      pedirBtn.disabled = false;
      pedirBtn.style.opacity = '1';
      pedirBtn.style.cursor = 'pointer';
      pedirBtn.innerHTML = `🏍️ Pedir Viaje &nbsp;·&nbsp; ${isWompi ? '💳 Wompi' : '💵 Efectivo'}`;
    }

  // ── Cambiar método de pago ──
  } else if (target.id === 'changePaymentBtn') {
    state.selectedPaymentMethod = null;

    const btnW = document.getElementById('payWompiBtn');
    const btnE = document.getElementById('payEfectivoBtn');
    if (btnW) { btnW.style.opacity='1'; btnW.style.transform='scale(1)'; btnW.style.boxShadow='none'; btnW.innerHTML='💳 Wompi'; }
    if (btnE) { btnE.style.opacity='1'; btnE.style.transform='scale(1)'; btnE.style.boxShadow='none'; btnE.innerHTML='💵 Efectivo'; }

    const changeRow = document.getElementById('changePaymentRow');
    if (changeRow) changeRow.style.display = 'none';

    const pedirBtn = document.getElementById('pedirViajeBtn');
    if (pedirBtn) {
      pedirBtn.disabled = true;
      pedirBtn.style.opacity = '0.35';
      pedirBtn.style.cursor = 'not-allowed';
      pedirBtn.innerHTML = '🏍️ Pedir Viaje';
    }

  // ── PEDIR VIAJE (inicia la búsqueda) ──
  } else if (target.id === 'pedirViajeBtn') {
    if (!state.selectedPaymentMethod) return;
    acceptRide(state, map);

  } else if (target.id === 'cancelRideBtn' || target.id === 'cancelSearchBtn') {
    cancelRide(state, map);
  }
});

// Suggestion dismiss on outside click
setupSuggestionDismiss();

// ── Register Service Worker (PWA) ──
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register(new URL('/sw.js', import.meta.url).href).catch(console.log);
}

// ── Wake Lock: Mantener pantalla encendida ──
let wakeLock = null;
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      console.log('🔆 Pantalla activa (Wake Lock ON)');
      wakeLock.addEventListener('release', () => {
        console.log('💤 Wake Lock liberado');
      });
    }
  } catch (err) {
    console.log('Wake Lock no disponible:', err.message);
  }
}
requestWakeLock();
// Reactivar al volver a la app (cambio de pestaña o multitarea)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') requestWakeLock();
});

// ── Restaurar viaje activo si existe ──
restoreActiveRide(state, map);

// ── Pre-warming Supabase (Cold Start Fix) ──
supabase.from('clientes').select('id').limit(1);

// ── Lógica de Billetera Zippy ──
const bonoCheckbox = document.getElementById('useBonoCheckbox');
if (bonoCheckbox) {
    bonoCheckbox.addEventListener('change', () => {
        let price = window.zippyCurrentBasePrice || 0;
        let bonoToUse = 0;
        if (bonoCheckbox.checked && window.zippyCurrentBono > 0) {
            bonoToUse = Math.min(price, window.zippyCurrentBono);
        }
        let finalPrice = price - bonoToUse;
        const el = document.getElementById('priceValue');
        if (el) el.textContent = '$' + finalPrice.toLocaleString('es-CO');
    });
}


// ── Tour de Bienvenida (Driver.js) ──
function iniciarTourPasajero() {
  if (!window.driver) return;
  const driverObj = window.driver.js.driver({
    showProgress: true,
    nextBtnText: 'Siguiente ▶',
    prevBtnText: '◀ Atrás',
    doneBtnText: '¡Entendido! ✅',
    popoverClass: 'zippy-driver-theme',
    steps: [
      { element: '#topSearchArea', popover: { title: 'Buscador Inteligente', description: 'Aquí puedes escribir el lugar donde estás y hacia dónde vas.', side: "bottom", align: 'start' }},
      { element: '#map', popover: { title: 'Toca el Mapa', description: 'También puedes arrastrar el mapa y tocar cualquier calle directamente para seleccionar tu destino al instante.', side: "top", align: 'start' }},
      { element: '#resetPointsBtn', popover: { title: 'Reiniciar Búsqueda', description: 'Si te equivocas, usa este botón para limpiar las direcciones y empezar de cero.', side: "bottom", align: 'start' }},
      { element: '#sidebarHeader', popover: { title: 'Tu Perfil y Viajes', description: 'Abre este menú para ver cuántos viajes llevas, tu información y para cerrar sesión.', side: "bottom", align: 'start' }}
    ],
    onDestroyStarted: () => {
      if (!driverObj.hasNextStep() || confirm("¿Seguro que quieres cerrar el tutorial?")) {
        driverObj.destroy();
        localStorage.setItem('zippy_tour_completed', 'true');
      }
    },
    onCloseClick: () => {
        driverObj.destroy();
        localStorage.setItem('zippy_tour_completed', 'true');
    }
  });
  driverObj.drive();
}


