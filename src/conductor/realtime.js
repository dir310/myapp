/**
 * Conductor realtime: Supabase subscriptions, ride accept/reject.
 */
import { supabase } from '../config/supabase.js';
import { renderViajes, showNewRideBanner, playAlert } from './ui.js';

let activeViajes = [];

/**
 * Get handlers for ride card actions (curried with state).
 */
function getHandlers() {
  return {
    onAccept: acceptViaje,
    onReject: rejectViaje,
    onVerify: verifyOtp,
    onFinish: finishViaje,
  };
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

        if (validStates.includes(payload.new.estado)) {
          if (index !== -1) {
            activeViajes[index] = payload.new;
          } else {
            activeViajes.unshift(payload.new);
          }
        } else {
          // Remove if finished or cancelled
          if (index !== -1) activeViajes.splice(index, 1);
        }
        renderViajes(activeViajes, getHandlers());
      }
    )
    .subscribe();
}

/**
 * Reject (hide) a ride locally.
 * @param {string} id - Ride UUID.
 */
function rejectViaje(id) {
  activeViajes = activeViajes.filter((v) => v.id !== id);
  renderViajes(activeViajes, getHandlers());
}

/**
 * Accept a ride: update Supabase and open Waze navigation.
 * @param {string} id - Ride UUID.
 * @param {number} lat - Origin latitude.
 * @param {number} lng - Origin longitude.
 */
async function acceptViaje(id, lat, lng) {
  const conductorName = document.getElementById('conductorName').value || 'Un Conductor';
  const otp = Math.floor(100 + Math.random() * 900); // 3 dígitos aleatorios

  const { error } = await supabase
    .from('viajes')
    .update({ 
      estado: 'aceptado', 
      conductor_id: conductorName, 
      codigo_otp: otp,
      // Al guardar, nos aseguramos que todavía esté buscando para evitar el error de "ya tomado"
    })
    .eq('id', id)
    .eq('estado', 'buscando');

  if (!error) {
    loadViajes();
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`, '_blank');
  } else {
    console.error('Error al aceptar viaje:', error);
    alert('¡Viaje ya tomado o error de conexión!');
  }
}

/**
 * Verify OTP entered by conductor.
 * @param {string} id - Ride UUID.
 */
async function verifyOtp(id) {
  const input = document.getElementById(`otp-${id}`);
  const code = input.value;

  const { data, error } = await supabase
    .from('viajes')
    .select('codigo_otp')
    .eq('id', id)
    .single();

  if (data && data.codigo_otp == code) {
    await supabase.from('viajes').update({ estado: 'en_progreso' }).eq('id', id);
    loadViajes();
  } else {
    alert('Código incorrecto. Pídele al cliente el código de 3 números.');
    console.error(error);
  }
}

/**
 * Finish a trip in progress.
 * @param {string} id - Ride UUID.
 */
async function finishViaje(id) {
  if (confirm('¿Estás seguro de finalizar el viaje?')) {
    await supabase.from('viajes').update({ estado: 'finalizado' }).eq('id', id);
    loadViajes();
  }
}
