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

  // Forzar petición explícita de GPS al momento de aceptar para activar permisos y capturar posición inicial
  let initialLocation = null;
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        initialLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        console.log('Ubicación inicial capturada al aceptar');
      },
      (err) => alert('Para aceptar viajes debes permitir el uso de tu ubicación GPS.')
    );
  }

  console.log('Intentando aceptar viaje:', id, 'por:', conductorName);

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
  } else if (data && data.length > 0) {
    console.log('Viaje aceptado con éxito');
    
    // Si tenemos la ubicación inicial, actualizarla de una vez para que el cliente vea la moto de inmediato
    if (initialLocation) {
        await supabase.from('viajes').update({ 
            conductor_lat: initialLocation.lat, 
            conductor_lng: initialLocation.lng 
        }).eq('id', id);
    }

    startGPS(id); // EMPEZAR EL TRACKING CONTINUO
    loadViajes();
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
    misViajesFinalizados.push(id); // Registrar para recibir calificación luego
    await supabase.from('viajes').update({ estado: 'finalizado' }).eq('id', id);
    stopGPS(); // Apagar GPS
    loadViajes();
  }
}
