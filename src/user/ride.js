/**
 * Ride request lifecycle: create, listen for driver, cancel.
 */
import { supabase } from '../config/supabase.js';
import { showStatus } from './ui.js';
import { clearPoint, placeMarker, checkRoute } from './routing.js';
import { motoIcon, animateMarker } from '../utils/map.js';
import { sanitizeHTML } from '../utils/security.js';

const STORAGE_KEY = 'calmovil_current_ride_id';

let driverMarker = null; // Guardará el ícono en vivo de la moto
let rideChannel = null; // Referencia al canal de Supabase

// local sanitizeInput removed in favor of centralized security.js
function playNotificationSound() {
  const audio = document.getElementById('notificationSound');
  if (audio) {
    audio.currentTime = 0;
    audio.play().catch(e => console.log('Audio play blocked:', e));
  }
}


/**
 * Request a ride by inserting into Supabase.
 * @param {object} state - Shared app state.
 * @param {L.Map} map - Leaflet map instance.
 */
export async function acceptRide(state, map) {
  if (!state.startLatLng || !state.endLatLng) return;
  state.driverArrived = false;

  const originName = sanitizeHTML(document.getElementById('startInput').value || 'Punto de Inicio', 120);
  const destName = sanitizeHTML(document.getElementById('endInput').value || 'Destino', 120);
  const priceStr = document.getElementById('priceValue').textContent.replace(/[^0-9]/g, '');
  const price = parseInt(priceStr, 10);
  const distText = document.getElementById('routeDistance').textContent + ' km';

  const btn = document.getElementById('acceptRideBtn');
  btn.innerHTML = '<span class="spinner" style="border-width:2px; height:14px; width:14px; margin-right:6px"></span> Pidiendo viaje...';
  btn.disabled = true;

  try {
    // Sanitizar datos del cliente antes de enviar
    const cNombre = sanitizeHTML(localStorage.getItem('calmovil_cliente_nombre') || 'Pasajero Anónimo', 60);
    const cCedula = sanitizeHTML(localStorage.getItem('calmovil_cliente_cedula') || '', 12);
    const cTelefono = sanitizeHTML(localStorage.getItem('calmovil_cliente_telefono') || '', 10);

    // Validar que el precio sea un número válido
    if (isNaN(price) || price <= 0) {
      throw new Error('Tarifa inválida. Por favor recalcula la ruta.');
    }

    const viajePayload = {
      origen_nombre: originName,
      origen_lat: state.startLatLng.lat,
      origen_lng: state.startLatLng.lng,
      destino_nombre: destName,
      destino_lat: state.endLatLng.lat,
      destino_lng: state.endLatLng.lng,
      tarifa: price,
      distancia_km: distText,
      estado: 'buscando',
      cliente_nombre: cNombre,
      cliente_cedula: cCedula,
      cliente_telefono: cTelefono,
      pasajero_id: localStorage.getItem('calmovil_cliente_id') || null
    };

    let data, error;
    let attempts = 0;
    const MAX_ATTEMPTS = 3;

    while (attempts < MAX_ATTEMPTS) {
      attempts++;
      const res = await supabase.from('viajes').insert([viajePayload]).select();
      data = res.data;
      error = res.error;

      if (!error) break; // Éxito: salimos del bucle

      console.warn(`Intento ${attempts} fallido (Cold Start?). Reintentando...`, error);
      if (attempts < MAX_ATTEMPTS) {
        btn.innerHTML = '<span class="spinner" style="border-width:2px; height:14px; width:14px; margin-right:6px"></span> Conectando...';
        await new Promise(r => setTimeout(r, 1500 * attempts)); // Espera incremental
      }
    }

    if (error) throw error;
    state.currentRideId = data[0].id;
    localStorage.setItem(STORAGE_KEY, state.currentRideId);

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
    showStatus('❌ Falló la conexión. Intenta pedir el viaje de nuevo.', true);
    btn.innerHTML = '🏍️ Pedir Viaje';
    btn.disabled = false;
    console.error(err);
  }
}

function updateETA(lat, lng, state) {
  const etaText = document.getElementById('etaText');
  if (!etaText || !state.startLatLng || state.driverArrived) return;

  const conductorPos = L.latLng(lat, lng);
  const distMeters = state.startLatLng.distanceTo(conductorPos);

  if (distMeters <= 50) {
    state.driverArrived = true;
    etaText.innerHTML = '🚕 ¡Tu conductor ha llegado!';
    etaText.style.color = '#fff';
    etaText.style.background = '#30D158'; // Verde success
    etaText.style.boxShadow = '0 4px 12px rgba(48,209,88,0.3)';
  } else {
    // 400 m/min es aprox 24 km/h en ciudad
    const mins = Math.max(1, Math.ceil(distMeters / 400));
    etaText.innerHTML = `🚕 Llegando en aprox. ${mins} min...`;
  }
}

/**
 * Listen for a driver accepting the ride (dual strategy: WebSocket + polling).
 * @param {string} rideId - Ride UUID.
 * @param {object} state - Shared app state.
 */
export function listenForDriver(rideId, state, map) {
  console.log('📡 Iniciando radar para viaje:', rideId);

  // Strategy 1: Real-time WebSocket
  rideChannel = supabase.channel('ride-watch-' + rideId);

  rideChannel
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

          if (payload.new.estado === 'aceptado' || payload.new.estado === 'en_progreso') {
            if (payload.new.estado === 'aceptado') playNotificationSound();
            showDriverAssigned(payload.new.conductor_id, state);
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
            playNotificationSound();
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
          updateETA(lat, lng, state);
        }
      }
    )
    .subscribe();

  // Strategy 2: Backup polling every 5 seconds
  if (state.pollerInterval) clearInterval(state.pollerInterval);
  state.pollerInterval = setInterval(async () => {
    const { data, error } = await supabase
      .from('viajes')
      .select('estado, conductor_id, conductor_lat, conductor_lng')
      .eq('id', rideId)
      .single();

    if (!error && data) {
      // 1. Actualizar Estado si cambió
      if (data.estado !== state.lastKnownEstado) {
        state.lastKnownEstado = data.estado;
        if (data.estado === 'aceptado' || data.estado === 'en_progreso') {
          if (data.estado === 'aceptado') playNotificationSound();
          showDriverAssigned(data.conductor_id, state);
        } else if (data.estado === 'finalizado') {
          showRatingScreen(state);
        } else if (data.estado === 'cancelado') {
          playNotificationSound();
          alert('⚠️ El conductor ha cancelado el servicio.');
          cancelRide(state, map);
        }
      }

      // 2. Actualización de GPS (Respaldo si falla el Websocket)
      if (data.conductor_lat && data.conductor_lng && map) {
        const lat = data.conductor_lat;
        const lng = data.conductor_lng;

        if (!driverMarker) {
          driverMarker = L.marker([lat, lng], {
            icon: motoIcon(),
            zIndexOffset: 1000
          }).addTo(map);
        } else {
          animateMarker(driverMarker, [lat, lng], 2000);
        }
        updateETA(lat, lng, state);
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
  import('./ui.js').then(({ showStatus }) => showStatus('', false));
  document.getElementById('priceSection').innerHTML = `
    <div style="text-align:center; padding: 10px 0;">
      <h3 style="color:#30D158; margin-bottom:5px; font-weight:800;">¡Conductor Asignado!</h3>
      <div style="background:rgba(255,255,255,.05); border:1.5px solid #30D158; border-radius:12px; padding:12px; margin-bottom:10px;">
        <span style="color:rgba(255,255,255,.4); font-size:10px; display:block; text-transform:uppercase;">Buscando datos del conductor...</span>
      </div>
    </div>
  `;

  // Fetch datos reales a base de datos
  const { data: driver } = await supabase.from('conductores').select('nombre, placa, telefono, marca, color').eq('id', driverId).single();

  // Fetch rating promedio del conductor desde la tabla viajes
  // Usamos un query más robusto para asegurar que traiga los datos
  const { data: ratingData } = await supabase
    .from('viajes')
    .select('calificacion')
    .eq('conductor_id', driverId)
    .not('calificacion', 'is', null);
  
  let driverRating = 'Sin reseñas aún';
  if (ratingData && ratingData.length > 0) {
    const validRatings = ratingData.filter(v => v.calificacion > 0);
    if (validRatings.length > 0) {
      const avg = validRatings.reduce((acc, v) => acc + v.calificacion, 0) / validRatings.length;
      driverRating = `${avg.toFixed(1)} ⭐ (${validRatings.length} viajes)`;
    }
  }

  let driverName = 'Conductor asignado';
  let driverDetails = {
    placa: '---',
    vehiculo: 'Vehículo',
    telefono: ''
  };

  if (driver) {
    driverName = driver.nombre;
    driverDetails = {
      placa: driver.placa || '---',
      vehiculo: `${driver.marca || ''} ${driver.color || ''}`.trim() || 'Moto',
      telefono: driver.telefono || ''
    };
  }

  document.getElementById('priceSection').innerHTML = `
    <div style="text-align:center; padding: 10px 0;">
      <h3 style="color:#30D158; margin-bottom:8px; font-weight:800; font-size:18px;">¡Conductor en camino!</h3>
      
      <div style="background:rgba(255,255,255,.03); border:1px solid rgba(48,209,88,0.2); border-radius:16px; padding:15px; margin-bottom:12px; box-shadow: 0 4px 20px rgba(0,0,0,0.2);">
        <!-- Encabezado: Nombre y Estrellas -->
        <div style="margin-bottom:15px;">
          <span style="color:rgba(255,255,255,.4); font-size:10px; display:block; text-transform:uppercase; letter-spacing:1px; margin-bottom:4px;">Tu Conductor</span>
          <span style="color:#fff; font-size:20px; font-weight:800; display:block;">${driverName}</span>
          <span style="color:#FFD700; font-size:14px; font-weight:700; display:block; margin-top:2px;">${driverRating}</span>
        </div>

        <!-- Cuerpo: Vehículo y Contacto -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; align-items: stretch;">
          <!-- Bloque Vehículo -->
          <div style="background:rgba(255,107,0,.08); border:1px solid rgba(255,107,0,.15); padding:10px; border-radius:12px; text-align:left;">
            <div style="margin-bottom:8px;">
              <span style="color:rgba(255,107,0,.6); font-size:9px; display:block; text-transform:uppercase; font-weight:800;">Moto</span>
              <span style="color:#fff; font-size:12px; font-weight:600; display:block;">${driverDetails.vehiculo}</span>
            </div>
            <div>
              <span style="color:rgba(255,107,0,.6); font-size:9px; display:block; text-transform:uppercase; font-weight:800;">Placa</span>
              <span style="color:#FF6B00; font-size:14px; font-weight:900; display:block;">${driverDetails.placa}</span>
            </div>
          </div>

          <!-- Bloque Llamada -->
          <a href="tel:${driverDetails.telefono}" style="background:#30D158; text-decoration:none; border-radius:12px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:5px; box-shadow:0 4px 15px rgba(48,209,88,0.3); transition: transform 0.2s;" onmousedown="this.style.transform='scale(0.95)'" onmouseup="this.style.transform='scale(1)'">
            <span style="font-size:24px;">📞</span>
            <span style="color:#fff; font-size:12px; font-weight:900; text-transform:uppercase;">Llamar</span>
          </a>
        </div>
      </div>

      <p id="etaText" style="color:#FFB347; font-size:14px; font-weight:bold; margin: 10px 0; background:rgba(255,255,255,.05); padding:10px; border-radius:12px; border: 1px solid rgba(255,255,255,0.05);">Calculando llegada...</p>
      
      <button class="btn" style="background:rgba(255,255,255,.03); color:rgba(255,255,255,.5); width:100%; margin-top:10px; font-size:12px; border: 1px solid rgba(255,255,255,0.05);" id="cancelRideBtnAction">Cancelar Servicio</button>
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
 * Show the rating screen (Redirected to simple reload).
 * @param {object} state - Shared app state.
 */
function showRatingScreen(state) {
  stopListening(state);
  const rideId = state.currentRideId;
  localStorage.removeItem(STORAGE_KEY);

  const priceSection = document.getElementById('priceSection');
  priceSection.style.display = 'block';
  priceSection.innerHTML = `
    <div style="text-align:center; padding:20px 10px;">
      <div style="font-size:40px; margin-bottom:8px;">🏁</div>
      <h3 style="color:#FF6B00; margin-bottom:5px; font-weight:800;">¡Viaje Finalizado!</h3>
      <p style="color:rgba(255,255,255,.6); font-size:13px; margin-bottom:20px;">¿Cómo fue tu experiencia con el conductor?</p>
      <div id="starRatingUser" style="display:flex; justify-content:center; gap:10px; font-size:38px; cursor:pointer; margin-bottom:10px;">
        <span data-star="1" style="filter:grayscale(1) opacity(.4);">⭐</span>
        <span data-star="2" style="filter:grayscale(1) opacity(.4);">⭐</span>
        <span data-star="3" style="filter:grayscale(1) opacity(.4);">⭐</span>
        <span data-star="4" style="filter:grayscale(1) opacity(.4);">⭐</span>
        <span data-star="5" style="filter:grayscale(1) opacity(.4);">⭐</span>
      </div>
      <div id="ratingLabelUser" style="color:#FF6B00; font-weight:bold; font-size:13px; min-height:20px; margin-bottom:15px;"></div>
      <button id="submitRatingUserBtn" class="btn btn-primary" style="width:100%; font-size:15px; padding:13px; opacity:.5;" disabled>Enviar Calificación</button>
      <button id="skipRatingUserBtn" class="btn" style="width:100%; margin-top:8px; background:rgba(255,255,255,.05); color:rgba(255,255,255,.4); font-size:12px;">Omitir</button>
    </div>
  `;

  let selectedRating = 0;
  const stars = document.querySelectorAll('#starRatingUser span');
  const submitBtn = document.getElementById('submitRatingUserBtn');
  const label = document.getElementById('ratingLabelUser');
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

  document.getElementById('submitRatingUserBtn').addEventListener('click', async () => {
    if (!selectedRating) return;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Enviando...';
    if (rideId) {
      await supabase.from('viajes').update({ calificacion: selectedRating }).eq('id', rideId);
    }
    location.reload();
  });

  document.getElementById('skipRatingUserBtn').addEventListener('click', () => location.reload());
}

/**
 * Stops all listeners (polling and websocket) and cleans up the map.
 * @param {object} state 
 */
export function stopListening(state) {
  if (state.pollerInterval) {
    clearInterval(state.pollerInterval);
    state.pollerInterval = null;
  }

  if (rideChannel) {
    supabase.removeChannel(rideChannel);
    rideChannel = null;
  }

  if (driverMarker) {
    // No removemos el marcador si queremos que el pasajero lo vea al final? 
    // Por ahora lo quitamos para limpiar memoria.
    console.log('[MovilCal] Limpiando marcador de conductor.');
  }
}

/**
 * Cancel the current ride request.
 * @param {object} state - Shared app state.
 * @param {L.Map} map - Leaflet map instance.
 */
export async function cancelRide(state, map) {
  stopListening(state);
  if (state.currentRideId) {
    localStorage.removeItem(STORAGE_KEY);
    await supabase.from('viajes').update({ estado: 'cancelado' }).eq('id', state.currentRideId);
  }
  location.reload();
}

/**
 * Restores an active ride after page refresh.
 */
export async function restoreActiveRide(state, map) {
  const savedId = localStorage.getItem(STORAGE_KEY);
  if (!savedId) return;

  console.log('🔄 Detectado viaje activo persistente:', savedId);

  try {
    const { data, error } = await supabase
      .from('viajes')
      .select('*')
      .eq('id', savedId)
      .single();

    if (error || !data) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }

    // Solo restaurar si el viaje no ha terminado
    if (['cancelado', 'finalizado'].includes(data.estado)) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }

    // 1. Restaurar Estado Base
    state.currentRideId = data.id;
    state.lastKnownEstado = data.estado;

    // 2. Restaurar Mapa (Marcadores y Ruta)
    placeMarker('start', data.origen_lat, data.origen_lng, data.origen_nombre, state, map);
    placeMarker('end', data.destino_lat, data.destino_lng, data.destino_nombre, state, map);

    // Forzamos el dibujado de la ruta y cálculo de precio en UI
    checkRoute(state, map);

    // 3. Restaurar UI de Búsqueda / Conductor
    if (data.estado === 'buscando') {
      document.getElementById('priceSection').innerHTML = `
          <div id="searchingContainer" style="text-align:center; padding: 25px 0;">
            <div class="spinner" style="border-color: rgba(255,107,0,.2); border-top-color: #FF6B00; width: 45px; height: 45px; border-width: 5px; margin-bottom: 25px;"></div>
            <h3 style="color:#FF6B00; margin-bottom:12px; font-weight:800; font-size:20px;">Buscando conductor...</h3>
            <p style="color:rgba(255,255,255,.6); font-size:13px; line-height:1.5;">Estamos avisando a los conductores cercanos. No cierres esta ventana.</p>
            <div style="margin-top:20px; color:#30D158; font-weight:bold; font-size:24px;">$${data.tarifa.toLocaleString('es-CO')}</div>
          </div>
          <button class="btn" style="background:rgba(255,255,255,.08); color:rgba(255,255,255,.8); width:100%; margin-top:10px" id="cancelSearchBtn">Cancelar Solicitud</button>
        `;
      document.getElementById('cancelSearchBtn').addEventListener('click', () => cancelRide(state, map));
      document.getElementById('priceSection').style.display = 'block';
    } else if (data.estado === 'aceptado' || data.estado === 'en_progreso') {
      // Alerta: showDriverAssigned es asíncrona pero la llamamos secuencialmente
      await showDriverAssigned(data.conductor_id, state);
      document.getElementById('priceSection').style.display = 'block';
    }

    // 4. Reconectar radares
    listenForDriver(state.currentRideId, state, map);

  } catch (err) {
    console.error('Error al restaurar viaje:', err);
    localStorage.removeItem(STORAGE_KEY);
  }
}
