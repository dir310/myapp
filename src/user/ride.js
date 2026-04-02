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
        } else if (payload.new.estado === 'en_progreso') {
          showTripStarted(state);
        } else if (payload.new.estado === 'finalizado') {
          showRatingScreen(state);
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

    if (!error && data) {
      if (data.estado === 'aceptado') {
        console.log('✅ Conductor encontrado vía Poller!');
        showDriverAssigned(data.conductor_id, state);
      } else if (data.estado === 'en_progreso') {
        showTripStarted(state);
      } else if (data.estado === 'finalizado') {
        showRatingScreen(state);
      }
    }
  }, 5000);
}

/**
 * Show the driver assigned UI.
 * @param {string} name - Driver name/identifier.
 * @param {object} state - Shared app state.
 */
function showDriverAssigned(name, state) {
  if (state.pollerInterval) {
    clearInterval(state.pollerInterval);
    state.pollerInterval = null;
  }

  const driverName = name || 'Un Conductor';

  document.getElementById('priceSection').innerHTML = `
    <div style="text-align:center; padding: 10px 0;">
      <div style="font-size:35px; margin-bottom: 8px;">🚕</div>
      <h3 style="color:#30D158; margin-bottom:5px; font-weight:800;">¡Conductor en camino!</h3>
      <div style="background:rgba(255,255,255,.05); border:1.5px solid #30D158; border-radius:12px; padding:12px; margin-bottom:10px;">
        <span style="color:rgba(255,255,255,.4); font-size:10px; display:block; text-transform:uppercase;">Datos del Conductor:</span>
        <span style="color:#fff; font-size:17px; font-weight:800; display:block; margin-top:4px;">${driverName}</span>
      </div>
      <p style="color:rgba(255,255,255,.6); font-size:12px;">En cuanto el conductor llegue, verás el mapa en tiempo real.</p>
      <button class="btn" style="background:rgba(255,255,255,.08); color:rgba(255,255,255,.8); width:100%; margin-top:10px" id="cancelRideBtnAction">Cancelar Servicio</button>
    </div>
  `;

  document.getElementById('cancelRideBtnAction').addEventListener('click', () => cancelRide(state, null));
}

/**
 * Show the trip in progress UI.
 * @param {object} state - Shared app state.
 */
function showTripStarted(state) {
  if (state.pollerInterval) {
    clearInterval(state.pollerInterval);
    state.pollerInterval = null;
  }
  document.getElementById('priceSection').innerHTML = `
    <div style="text-align:center; padding: 15px 0;">
      <div style="font-size:40px; margin-bottom: 12px;">✨</div>
      <h3 style="color:#FF6B00; margin-bottom:10px; font-weight:800;">Viaje en Progreso</h3>
      <p style="color:rgba(255,255,255,.6); font-size:13px;">Vas camino a tu destino. ¡Disfruta el viaje!</p>
      <div style="margin-top:20px; padding:10px; background:rgba(255,107,0,.1); border-radius:10px; border:1px solid rgba(255,107,0,.2); margin-bottom:15px;">
        <span style="color:#FF6B00; font-weight:bold;">Estado:</span> En camino...
      </div>
      <button class="btn" style="background:rgba(255,255,255,.08); color:rgba(255,255,255,.8); width:100%;" id="cancelTripInProgressBtn">Cancelar Servicio</button>
    </div>
  `;

  document.getElementById('cancelTripInProgressBtn').addEventListener('click', () => {
    if (confirm('¿Estás seguro de cancelar el viaje en curso?')) {
        cancelRide(state, null);
    }
  });
}

/**
 * Show the rating screen.
 * @param {object} state - Shared app state.
 */
function showRatingScreen(state) {
  if (state.pollerInterval) {
    clearInterval(state.pollerInterval);
    state.pollerInterval = null;
  }
  document.getElementById('ratingOverlay').style.display = 'flex';
}

/**
 * Cancel the current ride request.
 * @param {object} state - Shared app state.
 * @param {L.Map} map - Leaflet map instance.
 */
export async function cancelRide(state, map) {
  if (state.currentRideId) {
    await supabase.from('viajes').update({ estado: 'cancelado' }).eq('id', state.currentRideId);
  }
  location.reload();
}
