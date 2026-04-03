/**
 * Ride request lifecycle: create, listen for driver, cancel.
 */
import { supabase } from '../config/supabase.js';
import { showStatus } from './ui.js';
import { clearPoint } from './routing.js';
import { motoIcon, animateMarker } from '../utils/map.js';

let driverMarker = null; // Guardará el ícono en vivo de la moto

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
    listenForDriver(state.currentRideId, state, map);
  } catch (err) {
    showStatus('❌ Error al pedir viaje. Intenta de nuevo.', true);
    btn.innerHTML = '🏍️ Pedir Viaje';
    btn.disabled = false;
    console.error(err);
  }
}

/**
 * Listen for a driver accepting the ride (dual strategy: WebSocket + polling).
 * @param {string} rideId - Ride UUID.
 * @param {object} state - Shared app state.
 */
function listenForDriver(rideId, state, map) {
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
        // Evitar redibujar la UI si el estado no ha cambiado realmente (útil para cuando sólo cambia el GPS)
        const estadoCambio = payload.new.estado !== state.lastKnownEstado;
        
        if (estadoCambio) {
          console.log('⚡ Cambio detectado por Websocket:', payload.new.estado);
          state.lastKnownEstado = payload.new.estado;
          
          if (payload.new.estado === 'aceptado') {
            showDriverAssigned(payload.new.conductor_id, state);
          } else if (payload.new.estado === 'en_progreso') {
            showTripStarted(state);
          } else if (payload.new.estado === 'finalizado') {
            showRatingScreen(state);
            if (driverMarker && map) {
              map.removeLayer(driverMarker);
              driverMarker = null;
            }
          } else if (payload.new.estado === 'buscando') {
            showSearchingRecovery(state);
            if (driverMarker && map) {
              map.removeLayer(driverMarker);
              driverMarker = null;
            }
          } else if (payload.new.estado === 'cancelado') {
            alert('⚠️ El conductor ha cancelado el servicio.');
            cancelRide(state, map);
          }
        }

        // Live Tracking de la Moto (GPS Update)
        if (payload.new.conductor_lat && payload.new.conductor_lng && map) {
          const lat = payload.new.conductor_lat;
          const lng = payload.new.conductor_lng;
          
          if (!driverMarker) {
            driverMarker = L.marker([lat, lng], {
              icon: motoIcon(),
              zIndexOffset: 1000 // Siempre arriba
            }).addTo(map);
          } else {
            // Animar el movimiento suavemente (2 segundos de duración)
            animateMarker(driverMarker, [lat, lng], 2000);
          }
        }
      }
    )
    .subscribe();

  // Strategy 2: Backup polling every 5 seconds
  if (state.pollerInterval) clearInterval(state.pollerInterval);
  state.pollerInterval = setInterval(async () => {
    const { data, error } = await supabase
      .from('viajes')
      .select('estado, conductor_id')
      .eq('id', rideId)
      .single();

    if (!error && data) {
      if (data.estado !== state.lastKnownEstado) {
        state.lastKnownEstado = data.estado;
        if (data.estado === 'aceptado') {
          showDriverAssigned(data.conductor_id, state);
        } else if (data.estado === 'en_progreso') {
          showTripStarted(state);
        } else if (data.estado === 'finalizado') {
          showRatingScreen(state);
        } else if (data.estado === 'cancelado') {
          alert('⚠️ El conductor ha cancelado el servicio.');
          cancelRide(state, map);
        }
      }
    }
  }, 5000);
}

/**
 * Show the driver assigned UI.
 * @param {string} name - Driver name/identifier.
 * @param {object} state - Shared app state.
 */
async function showDriverAssigned(driverId, state) {
  if (state.pollerInterval) {
    clearInterval(state.pollerInterval);
    state.pollerInterval = null;
  }

  // Vista de carga inicial muy rápida
  document.getElementById('priceSection').innerHTML = `
    <div style="text-align:center; padding: 10px 0;">
      <h3 style="color:#30D158; margin-bottom:5px; font-weight:800;">¡Conductor Asignado!</h3>
      <div style="background:rgba(255,255,255,.05); border:1.5px solid #30D158; border-radius:12px; padding:12px; margin-bottom:10px;">
        <span style="color:rgba(255,255,255,.4); font-size:10px; display:block; text-transform:uppercase;">Buscando datos del conductor...</span>
      </div>
    </div>
  `;

  // Fetch datos reales a base de datos
  const { data: driver } = await supabase.from('conductores').select('nombre, placa, telefono').eq('id', driverId).single();
  
  let driverName = 'Conducto Anónimo';
  let driverDetails = 'Sin más datos';
  
  if (driver) {
    driverName = driver.nombre;
    driverDetails = `🏍️ ${driver.placa} &nbsp;|&nbsp; 📞 ${driver.telefono}`;
  }

  document.getElementById('priceSection').innerHTML = `
    <div style="text-align:center; padding: 10px 0;">
      <h3 style="color:#30D158; margin-bottom:5px; font-weight:800;">¡Conductor en camino!</h3>
      <div style="background:rgba(255,255,255,.05); border:1.5px solid #30D158; border-radius:12px; padding:15px 12px; margin-bottom:10px;">
        <span style="color:rgba(255,255,255,.4); font-size:10px; display:block; text-transform:uppercase; letter-spacing:1px;">Datos del Conductor:</span>
        <span style="color:#fff; font-size:18px; font-weight:800; display:block; margin-top:4px;">${driverName}</span>
        <div style="background:rgba(255,107,0,.15); color:#FF6B00; border:1px solid rgba(255,107,0,.3); display:inline-block; padding:5px 10px; border-radius:8px; margin-top:8px; font-weight:bold; font-size:13px;">
            ${driverDetails}
        </div>
      </div>
      <p style="color:rgba(255,255,255,.6); font-size:12px;">En cuanto el conductor arranque, verás el radar en tiempo real.</p>
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
 * Revert to searching UI if the driver cancelled the service.
 * @param {object} state - Shared app state.
 */
function showSearchingRecovery(state) {
  // Restart the polling interval just in case
  if (!state.pollerInterval) {
    state.pollerInterval = setInterval(async () => {
      const { data, error } = await supabase.from('viajes').select('estado, conductor_id').eq('id', state.currentRideId).single();
      if (!error && data) {
        if (data.estado === 'aceptado') showDriverAssigned(data.conductor_id, state);
        else if (data.estado === 'en_progreso') showTripStarted(state);
        else if (data.estado === 'finalizado') showRatingScreen(state);
      }
    }, 5000);
  }
  
  // Show notification
  alert('El conductor ha tenido un inconveniente y canceló el servicio. Te hemos regresado a la búsqueda automática de otro conductor.');
  
  // Revert UI to searching mode
  document.getElementById('priceSection').innerHTML = `
      <div id="searchingContainer" style="text-align:center; padding: 25px 0;">
        <div class="spinner" style="border-color: rgba(255,107,0,.2); border-top-color: #FF6B00; width: 45px; height: 45px; border-width: 5px; margin-bottom: 25px;"></div>
        <h3 style="color:#FF6B00; margin-bottom:12px; font-weight:800; font-size:20px;">Re-buscando conductor...</h3>
        <p style="color:rgba(255,255,255,.6); font-size:13px; line-height:1.5;">Estamos avisando a los conductores cercanos nuevamente. No cierres esta ventana.</p>
      </div>
      <button class="btn" style="background:rgba(255,255,255,.08); color:rgba(255,255,255,.8); width:100%; margin-top:10px" id="cancelSearchBtn">Cancelar Solicitud</button>
  `;
  
  document.getElementById('cancelSearchBtn').addEventListener('click', () => {
      cancelRide(state, null);
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
