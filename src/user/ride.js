/**
 * Ride request lifecycle: create, listen for driver, cancel.
 */
import { supabase } from '../config/supabase.js';
import { showStatus } from './ui.js';
import { clearPoint } from './routing.js';

/**
 * Request a ride by inserting into Supabase.
 * @param {object} state - Shared app state.
 * @param {L.Map} map - Leaflet map instance.
 */
export async function acceptRide(state, map) {
  if (!state.startLatLng || !state.endLatLng) return;

  const originName = document.getElementById('startInput').value || 'Punto de Inicio';
  const destName = document.getElementById('endInput').value || 'Destino';
  const priceStr = document.getElementById('priceValue').textContent.replace(/[^0-9]/g, '');
  const price = parseInt(priceStr, 10);
  const distText = document.getElementById('routeDistance').textContent + ' km';

  const btn = document.getElementById('acceptRideBtn');
  btn.innerHTML = '<span class="spinner" style="border-width:2px; height:14px; width:14px; margin-right:6px"></span> Pidiendo viaje...';
  btn.disabled = true;

  try {
    const { data, error } = await supabase.from('viajes').insert([
      {
        origen_nombre: originName,
        origen_lat: state.startLatLng.lat,
        origen_lng: state.startLatLng.lng,
        destino_nombre: destName,
        destino_lat: state.endLatLng.lat,
        destino_lng: state.endLatLng.lng,
        tarifa: price,
        distancia_km: distText,
        estado: 'buscando',
      },
    ]).select();

    if (error) throw error;
    state.currentRideId = data[0].id;

    // Show searching UI
    document.getElementById('priceSection').innerHTML = `
      <div id="searchingContainer" style="text-align:center; padding: 25px 0;">
        <div class="spinner" style="border-color: rgba(255,107,0,.2); border-top-color: #FF6B00; width: 45px; height: 45px; border-width: 5px; margin-bottom: 25px;"></div>
        <h3 style="color:#FF6B00; margin-bottom:12px; font-weight:800; font-size:20px;">Buscando conductor...</h3>
        <p style="color:rgba(255,255,255,.6); font-size:13px; line-height:1.5;">Estamos avisando a los conductores cercanos. No cierres esta ventana.</p>
        <div style="margin-top:20px; color:#30D158; font-weight:bold; font-size:24px;">$${price.toLocaleString('es-CO')}</div>
      </div>
      <button class="btn" style="background:rgba(255,255,255,.08); color:rgba(255,255,255,.8); width:100%; margin-top:10px" id="cancelSearchBtn">Cancelar Solicitud</button>
    `;

    // Attach cancel handler
    document.getElementById('cancelSearchBtn').addEventListener('click', () => {
      cancelRide(state, map);
    });

    // Start listening for driver
    listenForDriver(state.currentRideId, state);
  } catch (err) {
    showStatus('❌ Error al pedir viaje. Intenta de nuevo.', true);
    btn.innerHTML = '🚗 Pedir Viaje';
    btn.disabled = false;
    console.error(err);
  }
}

/**
 * Listen for a driver accepting the ride (dual strategy: WebSocket + polling).
 * @param {string} rideId - Ride UUID.
 * @param {object} state - Shared app state.
 */
function listenForDriver(rideId, state) {
  console.log('📡 Iniciando radar para viaje:', rideId);

  // Strategy 1: Real-time WebSocket
  supabase
    .channel('ride-watch-' + rideId)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'viajes',
        filter: `id=eq.${rideId}`,
      },
      (payload) => {
        console.log('⚡ Cambio detectado por Websocket:', payload.new.estado);
        if (payload.new.estado === 'aceptado') {
          showDriverAssigned(payload.new.conductor_id, state);
        }
      }
    )
    .subscribe();

  // Strategy 2: Backup polling every 5 seconds
  if (state.pollerInterval) clearInterval(state.pollerInterval);
  state.pollerInterval = setInterval(async () => {
    console.log('🔍 Verificando estado en base de datos (Backup Poller)...');
    const { data, error } = await supabase
      .from('viajes')
      .select('estado, conductor_id')
      .eq('id', rideId)
      .single();

    if (!error && data && data.estado === 'aceptado') {
      console.log('✅ Conductor encontrado vía Poller!');
      showDriverAssigned(data.conductor_id, state);
    }
  }, 5000);
}

/**
 * Show the driver assigned UI.
 * @param {string} name - Driver name/identifier.
 * @param {object} state - Shared app state.
 */
function showDriverAssigned(name, state) {
  if (state.pollerInterval) clearInterval(state.pollerInterval);
  state.pollerInterval = null;

  const driverName = name || 'Un Conductor';
  document.getElementById('priceSection').innerHTML = `
    <div style="text-align:center; padding: 15px 0;">
      <div style="font-size:45px; margin-bottom: 12px; animation:bounce 2s infinite;">🚕</div>
      <h3 style="color:#30D158; margin-bottom:10px; font-weight:800;">¡Conductor en camino!</h3>
      <div style="background:rgba(255,255,255,.05); border:1.5px solid #30D158; border-radius:12px; padding:15px; margin-bottom:15px;">
        <span style="color:rgba(255,255,255,.4); font-size:11px; display:block; text-transform:uppercase;">Tu Conductor es:</span>
        <span style="color:#fff; font-size:19px; font-weight:800;">${driverName}</span>
      </div>
      <p style="color:rgba(255,255,255,.6); font-size:13px;">Ya vas a ser recogido en tu ubicación actual. Ten listo el pago.</p>
      <button class="btn btn-primary" style="margin-top:20px; width:100%" id="newRideBtn">Nuevo Viaje</button>
    </div>
  `;

  document.getElementById('newRideBtn').addEventListener('click', () => location.reload());
}

/**
 * Cancel the current ride request.
 * @param {object} state - Shared app state.
 * @param {L.Map} map - Leaflet map instance.
 */
export function cancelRide(state, map) {
  if (state.currentRideId) {
    supabase.from('viajes').update({ estado: 'cancelado' }).eq('id', state.currentRideId);
  }
  clearPoint('start', state, map);
  clearPoint('end', state, map);
  state.currentRideId = null;
}
