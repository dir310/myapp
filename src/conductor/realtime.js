/**
 * Conductor realtime: Supabase subscriptions, ride accept/reject.
 */
import { supabase } from '../config/supabase.js';
import { renderViajes, showNewRideBanner, playAlert, showNotification, isRadarEnabled } from './ui.js';
import { getCurrentProfile, isDriverApproved } from './auth.js';
import { zippyAlert, zippyConfirm, zippyDanger, zippyPaymentToast } from '../utils/ui-global.js';

let activeViajes = [];
let misViajesFinalizados = []; // Track trips finished by this driver to ensure rating delivery

// Tracker GPS
let isTrackingGPS = false;
let currentTrackingTripId = null;
let gpsWatchId = null;
let wakeLock = null;

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      console.log('Wake Lock activado: pantalla se mantendrá encendida');
    }
  } catch (err) {
    console.error('Error con Wake Lock:', err.name, err.message);
  }
}

function releaseWakeLock() {
  if (wakeLock !== null) {
    wakeLock.release().then(() => { wakeLock = null; });
  }
}

async function startGPS(tripId) {
  if (isTrackingGPS) return; // Ya estamos trackeando
  if (!navigator.geolocation) return console.warn('GPS NO Soportado');

  isTrackingGPS = true;
  currentTrackingTripId = tripId;
  console.log('Iniciando rastreo GPS continuo para el viaje:', tripId);
  
  await requestWakeLock();

  let lastUpdate = 0;

  gpsWatchId = navigator.geolocation.watchPosition(
    async (pos) => {
      if (!isTrackingGPS || currentTrackingTripId !== tripId) return;
      
      const now = Date.now();
      if (now - lastUpdate < 1000) return; // Limitar a máximo 1 actualización cada 1s
      lastUpdate = now;

      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;

      try {
        await supabase
          .from('viajes')
          .update({ conductor_lat: lat, conductor_lng: lng })
          .eq('id', tripId)
          .in('estado', ['aceptado', 'en_progreso']);
      } catch (err) {
        console.error('GPS Update Error:', err.message);
      }
    },
    (err) => console.warn('GPS Watch Error:', err.message),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
  );
}

function stopGPS() {
  isTrackingGPS = false;
  currentTrackingTripId = null;
  if (gpsWatchId !== null) {
    navigator.geolocation.clearWatch(gpsWatchId);
    gpsWatchId = null;
  }
  releaseWakeLock();
  console.log('Rastreo GPS detenido.');
}

/**
 * Get handlers for ride card actions (curried with state).
 */
function getHandlers() {
  return {
    onAccept: acceptViaje,
    onReject: rejectViaje,
    onVerify: startViaje,
    onFinish: finishViaje,
    onCancelActive: cancelActiveViaje,
  };
}

/**
 * Cancel an active ride by the driver (sends it back to the searching pool).
 * @param {string} id - Ride UUID.
 */
async function cancelActiveViaje(id) {
  if (await zippyDanger(
    '⚠️ Esta cancelación queda registrada en tu historial. Cancelaciones frecuentes pueden resultar en la SUSPENSIÓN de tu cuenta de conductor. ¿Deseas continuar?',
    '⚠️',
    'Cancelar Servicio',
    { label: 'Sí, cancelar igual', emoji: '🚫' },
    { label: 'No, continuar el viaje', emoji: '↩️' }
  )) {
    const { error } = await supabase.from('viajes').update({ estado: 'buscando', conductor_id: null }).eq('id', id);
    if (!error) {
      activeViajes = activeViajes.filter((v) => v.id !== id);
      renderViajes(activeViajes, getHandlers());
      stopGPS();
    } else {
      zippyAlert('Error al cancelar: ' + error.message, '❌', 'Error técnico');
    }
  }
}

/**
 * Load initial active rides from Supabase.
 */
export async function loadViajes() {
  if (!isDriverApproved()) return; // Conductor en validación: no cargar viajes

  const profile = getCurrentProfile();
  const currentConductor = profile ? profile.id : null;

  const { data, error } = await supabase
    .from('viajes')
    .select('*')
    .or('estado.eq.buscando,estado.eq.aceptado,estado.eq.en_progreso')
    .order('created_at', { ascending: false });

  if (!error && data) {
    if (isRadarEnabled()) {
      // Radar activo: mostrar todo normalmente
      activeViajes = data;
    } else {
      // Radar apagado: mantener solo los viajes activos propios (aceptado/en_progreso)
      activeViajes = data.filter(
        (v) => v.conductor_id === currentConductor && (v.estado === 'aceptado' || v.estado === 'en_progreso')
      );
    }
    renderViajes(activeViajes, getHandlers());
  }
}



/**
 * Set up real-time channel for new and updated rides.
 */
export function setupRealtimeChannel() {
  if (!isDriverApproved()) return; // Conductor en validación: no suscribir canal
  setupRealtimeWithReconnect();
  // Polling de respaldo cada 4 segundos — solo si el radar está activo
  setInterval(() => { if (isDriverApproved() && isRadarEnabled()) loadViajes(); }, 4000);
}

// Reconexión automática del canal en tiempo real
function setupRealtimeWithReconnect() {
  let channel = null;

  function connect() {
    if (channel) supabase.removeChannel(channel);

    channel = supabase
      .channel('viajes-nuevos')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'viajes' },
        (payload) => {
          if (payload.new.estado === 'buscando') {
            // ── Radar apagado: ignorar solicitudes nuevas completamente ──
            if (!isRadarEnabled()) return;

            const bono = payload.new.bono_usado || 0;
            const cash = payload.new.tarifa - bono;
            const cashMsg = bono > 0 ? `💰 COBRAR: $${cash.toLocaleString('es-CO')} (BONO: $${bono.toLocaleString('es-CO')})` : `💵 Ganancia: $${cash.toLocaleString('es-CO')}`;

            activeViajes.unshift(payload.new);
            renderViajes(activeViajes, getHandlers());
            showNewRideBanner();
            playAlert();
            if (document.visibilityState === 'hidden' && Notification.permission === 'granted') {
              navigator.serviceWorker.ready.then(reg => {
                reg.showNotification('🚕 ¡Nueva Solicitud ZIPPY!', {
                  body: `${cashMsg} | ${payload.new.distancia_km}`,
                  icon: '/icons/icon-192x192.png',
                  badge: '/icons/icon-192x192.png',
                  vibrate: [500, 110, 500, 110, 500, 110, 500],
                  tag: 'nuevo-viaje',
                  renotify: true,
                  data: { url: '/' }
                });
              });
            }
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'viajes' },
        (payload) => {
          const index = activeViajes.findIndex((v) => v.id === payload.new.id);
          const validStates = ['buscando', 'aceptado', 'en_progreso'];
          if (payload.new.estado === 'cancelado' && index !== -1) {
            showNotification('¡El cliente canceló el servicio!', 'error');
          }
          if (payload.new.calificacion && payload.new.calificacion > 0) {
            const profile = getCurrentProfile();
            const currentDriver = profile ? profile.id : null;
            if (payload.new.conductor_id === currentDriver || misViajesFinalizados.includes(payload.new.id)) {
              showNotification(`¡Recibiste ${payload.new.calificacion} estrellas!`, 'success');
              misViajesFinalizados = misViajesFinalizados.filter(id => id !== payload.new.id);
            }
          }
          // ── Notificación de método de pago ──
          const oldTrip = activeViajes.find(v => v.id === payload.new.id);
          if (oldTrip) {
            const wompiAcabaDePagar = !oldTrip.pago_wompi && payload.new.pago_wompi === true;
            const efectivoConfirmado = !oldTrip.pago_efectivo_confirmado && payload.new.pago_efectivo_confirmado === true;
            if (wompiAcabaDePagar) zippyPaymentToast('wompi');
            else if (efectivoConfirmado) zippyPaymentToast('efectivo');
          }

          if (validStates.includes(payload.new.estado)) {
            let needsRender = false;
            if (index !== -1) {
              const oldTrip = activeViajes[index];
              if (oldTrip.estado !== payload.new.estado || oldTrip.calificacion !== payload.new.calificacion || oldTrip.pago_wompi !== payload.new.pago_wompi) needsRender = true;
              activeViajes[index] = payload.new;
            } else {
              activeViajes.unshift(payload.new);
              needsRender = true;
            }
            if (needsRender) renderViajes(activeViajes, getHandlers());
          } else {
            if (index !== -1) {
              activeViajes.splice(index, 1);
              renderViajes(activeViajes, getHandlers());
            }
          }
        }
      )
      .subscribe((status) => {
        if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
          console.warn('[ZIPPY] WebSocket caído, reconectando en 3s...');
          setTimeout(connect, 3000);
        }
      });
  }

  connect();
}

/**
 * Reject (hide) a ride locally.
 * @param {string} id - Ride UUID.
 */
async function rejectViaje(id) {
  const { error } = await supabase.from('viajes').delete().eq('id', id);
  if (!error) {
    activeViajes = activeViajes.filter((v) => v.id !== id);
    renderViajes(activeViajes, getHandlers());
  } else {
    console.error('Error al ocultar/eliminar viaje:', error);
  }
}

/**
 * Accept a ride: update Supabase and set driver.
 * @param {string} id - Ride UUID.
 * @param {number} lat - Origin latitude.
 * @param {number} lng - Origin longitude.
 */
async function acceptViaje(id, lat, lng) {
  const profile = getCurrentProfile();

  if (!profile) {
    zippyAlert('Error de sesión: No se pudo obtener tu perfil de conductor. Por favor refresca la página o inicia sesión de nuevo.', '❌');
    return;
  }
  const conductorName = profile.nombre;
  const conductorId = profile.id;

  console.log('Intentando aceptar viaje instantáneamente:', id);

  // 1. ACEPTAR VIAJE DE INMEDIATO (Feedback instantáneo)
  const { data, error } = await supabase
    .from('viajes')
    .update({
      estado: 'aceptado',
      conductor_id: conductorId
    })
    .eq('id', id)
    .eq('estado', 'buscando')
    .select();

  if (error) {
    console.error('Error de Supabase:', error);
    zippyAlert('Error técnico: ' + error.message, '❌');
    return;
  }

  if (data && data.length > 0) {
    console.log('Viaje aceptado con éxito (UI)');
    startGPS(id); // EMPEZAR EL TRACKING CONTINUO
    loadViajes();

    // 2. CAPTURAR GPS EN SEGUNDO PLANO (Sin bloquear el botón)
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          await supabase.from('viajes').update({
            conductor_lat: lat,
            conductor_lng: lng
          }).eq('id', id);
          console.log('GPS inicial enviado en segundo plano');
        },
        null, // Fallo silencioso aquí para no molestar al conductor
        { enableHighAccuracy: true, timeout: 5000 }
      );
    }
  }
}

/**
 * Start a trip directly (skipping OTP) and open Waze to destination manually later.
 * @param {string} id - Ride UUID.
 */
async function startViaje(id) {
  const { error } = await supabase.from('viajes').update({ estado: 'en_progreso' }).eq('id', id);
  if (!error) {
    // Asegurar que el GPS siga activo
    startGPS(id);
    loadViajes();
  } else {
    zippyAlert('Error al iniciar viaje: ' + error.message, '❌');
  }
}

/**
 * Finish a trip in progress.
 * @param {string} id - Ride UUID.
 */
async function finishViaje(id) {
  if (await zippyConfirm(
    '¿El pasajero pagó y está listo para bajarse?',
    '🏁',
    'Finalizar Viaje',
    { label: 'Sí, finalizar viaje', emoji: '🏁' },
    { label: 'No, esperar', emoji: '↩️' }
  )) {
    misViajesFinalizados.push(id);
    const viaje = activeViajes.find(v => v.id === id);
    const clienteNombre = viaje ? (viaje.cliente_nombre || 'Pasajero') : 'Pasajero';

    // Si no pagó por Wompi ni estaba marcado como efectivo → cobró en efectivo al finalizar
    const updates = { estado: 'finalizado' };
    if (viaje && !viaje.pago_wompi && !viaje.pago_efectivo_confirmado) {
      updates.pago_efectivo_confirmado = true;
    }
    await supabase.from('viajes').update(updates).eq('id', id);
    
    // Bono Frecuente: Dar 2000 COP cada 10 viajes terminados
    if (viaje && viaje.pasajero_id) {
       const { count } = await supabase.from('viajes')
         .select('id', { count: 'exact', head: true })
         .eq('pasajero_id', viaje.pasajero_id)
         .eq('estado', 'finalizado');
         
       if (count > 0 && count % 10 === 0) {
           const { data: cData } = await supabase.from('clientes').select('saldo_bono').eq('id', viaje.pasajero_id).single();
           if (cData) {
               await supabase.from('clientes').update({ saldo_bono: (cData.saldo_bono || 0) + 2000 }).eq('id', viaje.pasajero_id);
           }
       }
    }
    stopGPS();
    loadViajes();
    showClientRatingModal(id, clienteNombre);
  }
}

function showClientRatingModal(viajeId, clienteNombre) {
  const overlay = document.createElement('div');
  overlay.id = 'clientRatingOverlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.88);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;';
  overlay.innerHTML = `
    <div style="background:#1c1c1e;border-radius:20px;padding:30px;max-width:340px;width:100%;text-align:center;border:1px solid rgba(255,107,0,.3);">
      <div style="font-size:40px;margin-bottom:10px;">⭐</div>
      <h3 style="color:#FF6B00;margin-bottom:5px;font-weight:800;">Califica al Pasajero</h3>
      <p style="color:rgba(255,255,255,.6);font-size:13px;margin-bottom:20px;">${clienteNombre}</p>
      <div id="clientStarRating" style="display:flex;justify-content:center;gap:10px;font-size:38px;cursor:pointer;margin-bottom:10px;">
        <span data-star="1" style="filter:grayscale(1) opacity(.4);">⭐</span>
        <span data-star="2" style="filter:grayscale(1) opacity(.4);">⭐</span>
        <span data-star="3" style="filter:grayscale(1) opacity(.4);">⭐</span>
        <span data-star="4" style="filter:grayscale(1) opacity(.4);">⭐</span>
        <span data-star="5" style="filter:grayscale(1) opacity(.4);">⭐</span>
      </div>
      <div id="clientRatingLabel" style="color:#FF6B00;font-weight:bold;font-size:13px;min-height:20px;margin-bottom:15px;"></div>
      <button id="submitClientRatingBtn" style="width:100%;background:#FF6B00;color:#fff;border:none;border-radius:12px;padding:14px;font-size:16px;font-weight:800;cursor:pointer;opacity:.5;" disabled>Calificar Pasajero</button>
      <button id="skipClientRatingBtn" style="display:block;width:100%;background:none;border:none;color:rgba(255,255,255,.4);font-size:12px;margin-top:12px;cursor:pointer;padding:8px;">Omitir</button>
    </div>
  `;
  document.body.appendChild(overlay);

  let selectedRating = 0;
  const stars = overlay.querySelectorAll('#clientStarRating span');
  const submitBtn = overlay.querySelector('#submitClientRatingBtn');
  const label = overlay.querySelector('#clientRatingLabel');
  const texts = ['', 'Muy malo 😞', 'Malo 😕', 'Regular 😐', 'Bueno 😊', 'Excelente 🤩'];

  stars.forEach(star => {
    star.addEventListener('click', () => {
      selectedRating = parseInt(star.dataset.star);
      stars.forEach((s, i) => {
        s.style.filter = i < selectedRating ? 'none' : 'grayscale(1) opacity(.4)';
      });
      label.textContent = texts[selectedRating];
      submitBtn.disabled = false;
      submitBtn.style.opacity = '1';
    });
  });

  submitBtn.addEventListener('click', async () => {
    if (!selectedRating) return;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Enviando...';

    const { error } = await supabase
      .from('viajes')
      .update({ calificacion_cliente: selectedRating })
      .eq('id', viajeId);

    if (error) {
      console.error('Error al calificar cliente:', error);
      zippyAlert('No se pudo guardar la calificación del cliente: ' + (error.message || 'Error de permisos'), '❌');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Reintentar Calificar';
    } else {
      document.body.removeChild(overlay);
    }
  });

  overlay.querySelector('#skipClientRatingBtn').addEventListener('click', () => {
    document.body.removeChild(overlay);
  });
}
