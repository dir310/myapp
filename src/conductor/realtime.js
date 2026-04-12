/**
 * Conductor realtime: Supabase subscriptions, ride accept/reject.
 */
import { supabase } from '../config/supabase.js';
import { renderViajes, showNewRideBanner, playAlert, showNotification } from './ui.js';
import { getCurrentProfile } from './auth.js';

let activeViajes = [];
let misViajesFinalizados = []; // Track trips finished by this driver to ensure rating delivery

// Tracker GPS
let activeWatchId = null;
let currentTrackingTripId = null;

function startGPS(tripId) {
  if (activeWatchId) return; // Ya estamos trackeando
  if (!navigator.geolocation) return console.warn('GPS NO Soportado');
  
  currentTrackingTripId = tripId;
  console.log('Iniciando rastreo GPS para el viaje:', tripId);

  activeWatchId = navigator.geolocation.watchPosition(
    async (position) => {
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      
      // Update DB silently
      await supabase
        .from('viajes')
        .update({ conductor_lat: lat, conductor_lng: lng })
        .eq('id', tripId)
        .in('estado', ['aceptado', 'en_progreso']);
    },
    (err) => console.error('GPS Error:', err.message),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 }
  );
}

function stopGPS() {
  if (activeWatchId && navigator.geolocation) {
    navigator.geolocation.clearWatch(activeWatchId);
    activeWatchId = null;
    currentTrackingTripId = null;
    console.log('Rastreo GPS detenido.');
  }
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
  if (confirm('¿Estás seguro de cancelar este servicio activo? Volverá a estar disponible para otros conductores.')) {
    const { error } = await supabase.from('viajes').update({ estado: 'buscando', conductor_id: null }).eq('id', id);
    if (!error) {
        activeViajes = activeViajes.filter((v) => v.id !== id);
        renderViajes(activeViajes, getHandlers());
        stopGPS();
    } else {
        alert('Error al cancelar: ' + error.message);
    }
  }
}

/**
 * Load initial active rides from Supabase.
 */
export async function loadViajes() {
  const { data, error } = await supabase
    .from('viajes')
    .select('*')
    .or('estado.eq.buscando,estado.eq.aceptado,estado.eq.en_progreso')
    .order('created_at', { ascending: false });

  if (!error && data) {
    activeViajes = data;
    renderViajes(activeViajes, getHandlers());
  }
}



/**
 * Set up real-time channel for new and updated rides.
 */
export function setupRealtimeChannel() {
  supabase
    .channel('viajes-nuevos')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'viajes' },
      (payload) => {
        if (payload.new.estado === 'buscando') {
          activeViajes.unshift(payload.new);
          renderViajes(activeViajes, getHandlers());

          // Visual + audio alert
          showNewRideBanner();
          playAlert();

          // Notificación del Sistema (Background / locked screen) usando Service Worker (más fiable)
          if (document.visibilityState === 'hidden' && Notification.permission === "granted") {
            navigator.serviceWorker.ready.then(registration => {
              registration.showNotification("🚕 ¡Nueva Solicitud ZIPPY!", {
                body: `Ganancia: $${payload.new.tarifa.toLocaleString('es-CO')} | ${payload.new.distancia_km}`,
                icon: '/icons/icon-192x192.png',
                badge: '/icons/icon-192x192.png', // Ícono pequeño para la barra de estado
                vibrate: [200, 100, 200, 100, 200], // Patrón de vibración fuerte
                tag: 'nuevo-viaje',
                data: { url: '/' } // Datos para el clic
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

        // Notificar si el cliente canceló un viaje que teníamos activo
        if (payload.new.estado === 'cancelado' && index !== -1) {
          showNotification('¡El cliente canceló el servicio!', 'error');
        }

        // Notificar si recibimos una calificación
        if (payload.new.calificacion && payload.new.calificacion > 0) {
            const profile = getCurrentProfile();
            const currentDriver = profile ? profile.id : 'Un Conductor';
            if (payload.new.conductor_id === currentDriver || misViajesFinalizados.includes(payload.new.id)) {
                showNotification(`¡Recibiste ${payload.new.calificacion} estrellas!`, 'success');
                misViajesFinalizados = misViajesFinalizados.filter(id => id !== payload.new.id);
            }
        }

        if (validStates.includes(payload.new.estado)) {
          let needsRender = false;
          if (index !== -1) {
            const oldTrip = activeViajes[index];
            // Renderizar SOLO si cambió de estado (ej: de buscando a aceptado)
            if (oldTrip.estado !== payload.new.estado || oldTrip.calificacion !== payload.new.calificacion) {
              needsRender = true;
            }
            activeViajes[index] = payload.new;
          } else {
            activeViajes.unshift(payload.new);
            needsRender = true;
          }
          if (needsRender) renderViajes(activeViajes, getHandlers());
        } else {
          // Remove if finished or cancelled
          if (index !== -1) {
             activeViajes.splice(index, 1);
             renderViajes(activeViajes, getHandlers());
          }
        }
      }
    )
    .subscribe();

  // Polling de respaldo cada 10 segundos por si el WebSocket cae
  setInterval(() => loadViajes(), 10000);
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
    alert('Error de sesión: No se pudo obtener tu perfil de conductor. Por favor refresca la página o inicia sesión de nuevo.');
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
    alert('Error técnico: ' + error.message);
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
    alert('Error al iniciar viaje: ' + error.message);
  }
}

/**
 * Finish a trip in progress.
 * @param {string} id - Ride UUID.
 */
async function finishViaje(id) {
  if (confirm('¿Estás seguro de finalizar el viaje?')) {
    misViajesFinalizados.push(id);
    const viaje = activeViajes.find(v => v.id === id);
    const clienteNombre = viaje ? (viaje.cliente_nombre || 'Pasajero') : 'Pasajero';
    await supabase.from('viajes').update({ estado: 'finalizado' }).eq('id', id);
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
      alert('No se pudo guardar la calificación del cliente: ' + (error.message || 'Error de permisos'));
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
