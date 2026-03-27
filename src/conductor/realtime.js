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
  };
}

/**
 * Load initial active rides from Supabase.
 */
export async function loadViajes() {
  const { data, error } = await supabase
    .from('viajes')
    .select('*')
    .eq('estado', 'buscando')
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
        if (payload.new.estado !== 'buscando') {
          activeViajes = activeViajes.filter((v) => v.id !== payload.new.id);
          renderViajes(activeViajes, getHandlers());
        }
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
  const conductor = document.getElementById('conductorName').value || 'Un Conductor';

  const { error } = await supabase
    .from('viajes')
    .update({ estado: 'aceptado', conductor_id: conductor })
    .eq('id', id);

  if (!error) {
    activeViajes = activeViajes.filter((v) => v.id !== id);
    renderViajes(activeViajes, getHandlers());
    window.open(`https://waze.com/ul?ll=${lat},${lng}&navigate=yes`, '_blank');
  } else {
    alert('¡Viaje ya tomado o error de conexión!');
  }
}
