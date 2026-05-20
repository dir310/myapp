/**
 * Ride request lifecycle: create, listen for driver, cancel.
 */
import { supabase } from '../config/supabase.js';
import { showStatus } from './ui.js';
import { clearPoint, placeMarker, checkRoute } from './routing.js';
import { motoIcon, animateMarker } from '../utils/map.js';
import { sanitizeHTML } from '../utils/security.js';
import { initGame, stopGame } from './game.js';
import { generateRideCode } from '../utils/id.js';
import { zippyAlert, zippyConfirm } from '../utils/ui-global.js';

const STORAGE_KEY = 'calmovil_current_ride_id';

const OS_APP_ID = 'd1912f76-c166-43c4-b85b-fc461630445d';
const OS_API_KEY = 'os_v2_app_2gis65wbmzb4joc37rdbmmcelv7voadc7rzexsngbh3qb6fmhcvmghh7zrgiwoskzcr6ginu5zlzs5pj5vogpnizv6xdiuf2uhpx77y';

async function sendPushToDrivers(tarifa, distancia) {
  try {
    await fetch('https://api.onesignal.com/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Key ${OS_API_KEY}`
      },
      body: JSON.stringify({
        app_id: OS_APP_ID,
        included_segments: ['Total Subscriptions'],
        headings: { en: '🚕 ¡Nueva Solicitud ZIPPY!', es: '🚕 ¡Nueva Solicitud ZIPPY!' },
        contents: {
          en: `Ganancia: $${tarifa.toLocaleString('es-CO')} | ${distancia}`,
          es: `Ganancia: $${tarifa.toLocaleString('es-CO')} | ${distancia}`
        },
        url: 'https://appzippy.com/conductor/',
        chrome_web_icon: 'https://appzippy.com/icons/icon-192x192.png',
        priority: 10,
        ttl: 120
      })
    });
    console.log('[ZIPPY] Push enviado a conductores');
  } catch (e) {
    console.log('[ZIPPY] Push silenciado:', e);
  }
}

let driverMarker = null;
let driverRouteLayer = null;   // Polyline de ruta conductor → Punto A
let driverMapFocused = false;  // Bandera: primer foco ya hecho
let lastRouteFetch = 0;        // Throttle peticiones OSRM
let rideChannel = null;        // Referencia al canal de Supabase
let gpsPollerInterval = null;  // Polling GPS dedicado (independiente del WebSocket)

/**
 * Centra el mapa en el conductor y dibuja la ruta hacia el Punto A.
 * Primera vez: fitBounds para dar contexto. Siguientes: panTo suave.
 */
function updateDriverMap(lat, lng, state, map) {
  if (!map) return;

  // ── Foco del mapa ──
  if (!driverMapFocused && state.startLatLng) {
    map.fitBounds(L.latLngBounds([state.startLatLng, [lat, lng]]).pad(0.5), { animate: true });
    driverMapFocused = true;
  } else {
    map.panTo([lat, lng], { animate: true, duration: 1.2 });
  }

  // ── Ruta conductor → Punto A (throttle: 1 petición cada 15s) ──
  if (!state.startLatLng) return;
  const now = Date.now();
  if (now - lastRouteFetch < 15000) return;
  lastRouteFetch = now;

  const pickupLat = state.startLatLng.lat;
  const pickupLng = state.startLatLng.lng;
  const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${lng},${lat};${pickupLng},${pickupLat}?overview=full&geometries=geojson`;

  fetch(osrmUrl)
    .catch(() => fetch(`https://corsproxy.io/?${encodeURIComponent(osrmUrl)}`))
    .then(r => r.json())
    .then(data => {
      if (data.code === 'Ok' && data.routes?.length) {
        const coords = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
        if (driverRouteLayer) map.removeLayer(driverRouteLayer);
        driverRouteLayer = L.polyline(coords, {
          color: '#007AFF',
          weight: 5,
          opacity: 0.85,
          className: 'animated-driver-route'
        }).addTo(map);
      }
    })
    .catch(() => {});
}

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

  // --- Bloqueo por Validación Pendiente ---
  const status = localStorage.getItem('zippy_passenger_status');
  if (status === 'pendiente') {
    await zippyAlert('⚠️ Tu cuenta está en proceso de validación por seguridad. Podrás pedir viajes en cuanto el administrador te apruebe (esto suele tardar unos minutos).', '⌛');
    return;
  }

  state.driverArrived = false;

  // Limpiar UI de selección


  const originName = sanitizeHTML(document.getElementById('startInput').value || 'Punto de Inicio', 120);
  const destName = sanitizeHTML(document.getElementById('endInput').value || 'Destino', 120);
  const basePrice = window.zippyCurrentBasePrice || parseInt(document.getElementById('priceValue').textContent.replace(/[^0-9]/g, ''), 10);

  let bonoUsado = 0;
  const bonoCb = document.getElementById('useBonoCheckbox');
  if (bonoCb && bonoCb.checked && window.zippyCurrentBono > 0) {
    bonoUsado = Math.min(basePrice, window.zippyCurrentBono);
  }

  const distText = document.getElementById('routeDistance').textContent + ' km';

  const btnW = document.getElementById('payWompiBtn');
  const btnE = document.getElementById('payEfectivoBtn');
  if (btnW) btnW.disabled = true;
  if (btnE) btnE.disabled = true;
  const activeBtn = state.selectedPaymentMethod === 'wompi' ? btnW : btnE;
  if (activeBtn) activeBtn.innerHTML = '<span class="spinner" style="border-width:2px; height:14px; width:14px; margin-right:6px"></span> Pidiendo...';

  try {
    // Sanitizar datos del cliente antes de enviar
    const cNombre = sanitizeHTML(localStorage.getItem('calmovil_cliente_nombre') || 'Pasajero Anónimo', 60);
    const cCedula = sanitizeHTML(localStorage.getItem('calmovil_cliente_cedula') || '', 12);
    const cTelefono = sanitizeHTML(localStorage.getItem('calmovil_cliente_telefono') || '', 10);

    // Validar que el precio sea un número válido
    if (isNaN(basePrice) || basePrice <= 0) {
      throw new Error('Tarifa inválida. Por favor recalcula la ruta.');
    }

    const rideCode = generateRideCode();

    const viajePayload = {
      codigo_viaje: rideCode,
      origen_nombre: originName,
      origen_lat: state.startLatLng.lat,
      origen_lng: state.startLatLng.lng,
      destino_nombre: destName,
      destino_lat: state.endLatLng.lat,
      destino_lng: state.endLatLng.lng,
      tarifa: basePrice,
      bono_usado: bonoUsado,
      distancia_km: distText,
      estado: 'buscando',
      cliente_nombre: cNombre,
      cliente_cedula: cCedula,
      cliente_telefono: cTelefono,
      pasajero_id: localStorage.getItem('calmovil_cliente_id') || null,
      pago_efectivo_confirmado: state.selectedPaymentMethod === 'efectivo',
      multa_cobrada: window.zippyCurrentMulta || 0
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
        if (activeBtn) activeBtn.innerHTML = '<span class="spinner" style="border-width:2px; height:14px; width:14px; margin-right:6px"></span> Conectando...';
        await new Promise(r => setTimeout(r, 1500 * attempts)); // Espera incremental
      }
    }

    if (error) throw error;

    if (bonoUsado > 0) {
      // Actualizar UI local
      window.zippyCurrentBono -= bonoUsado;
      let bonoEl = document.getElementById('displayClientBono');
      let bonoTextEl = document.getElementById('availableBonoText');
      if (bonoEl) bonoEl.textContent = '$' + window.zippyCurrentBono.toLocaleString('es-CO');
      if (bonoTextEl) bonoTextEl.textContent = '$' + window.zippyCurrentBono.toLocaleString('es-CO');
      let bonoContainer = document.getElementById('bonoContainer');
      if (window.zippyCurrentBono <= 0 && bonoContainer) {
        bonoContainer.style.display = 'none';
      }

      // Descontar en backend
      const passengerId = localStorage.getItem('calmovil_cliente_id');
      if (passengerId) {
        supabase.from('clientes').update({ saldo_bono: window.zippyCurrentBono }).eq('id', passengerId).then();
      }
    }

    state.currentRideId = data[0].id;
    state.rideCode = data[0].codigo_viaje;
    localStorage.setItem(STORAGE_KEY, state.currentRideId);

    // Notificar conductores via OneSignal (directo desde el navegador del pasajero)
    sendPushToDrivers(basePrice, distText);

    let finalPriceToPay = basePrice - bonoUsado;

    // Show searching UI with native CSS Radar
    document.getElementById('priceSection').innerHTML = `
      <div id="searchingContainer" style="text-align:center; padding: 20px 0;">
        <div class="premium-radar">
          <div class="radar-moto-icon">🏍️</div>
        </div>
        <h3 style="color:#FF6B00; margin-bottom:12px; font-weight:800; font-size:20px;">Buscando conductor...</h3>
        <p style="color:rgba(255,255,255,.6); font-size:13px; line-height:1.5; padding:0 20px;">Estamos avisando a los conductores cercanos. No cierres esta ventana.</p>
        <div style="margin-top:20px; color:#30D158; font-weight:bold; font-size:24px;">$${finalPriceToPay.toLocaleString('es-CO')}</div>
        ${bonoUsado > 0 ? `<div style="color:#3498DB; font-size:12px; font-weight:bold;">(Bono aplicado: -$${bonoUsado.toLocaleString('es-CO')})</div>` : ''}
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
    if (btnW) { btnW.innerHTML = '💳 Wompi'; btnW.disabled = false; }
    if (btnE) { btnE.innerHTML = '💵 Efectivo'; btnE.disabled = false; }
    console.error(err);
  }
}

let lastETAFetch = 0;
function updateETA(lat, lng, state) {
  const etaText = document.getElementById('etaText');
  if (!etaText || !state.startLatLng || state.driverArrived) return;

  const conductorPos = L.latLng(lat, lng);
  const distMeters = state.startLatLng.distanceTo(conductorPos);

  if (distMeters <= 60) {
    state.driverArrived = true;
    etaText.innerHTML = '🏍️ ¡Tu conductor ha llegado!';
    etaText.style.color = '#fff';
    etaText.style.background = '#30D158';
    etaText.style.boxShadow = '0 4px 12px rgba(48,209,88,0.3)';

    // Auto-cerrar juego si el conductor llegó
    stopGame();
    return;
  }

  // Si está muy cerca (120m), avisar y cerrar juego
  if (distMeters <= 120) {
    stopGame();
  }

  // Si ha pasado poco tiempo, no volvemos a llamar a la API (ahorro de cuota)
  const now = Date.now();
  if (now - lastETAFetch < 15000) return; // Máximo una consulta cada 15 seg
  lastETAFetch = now;

  // Calculo real por calles usando OSRM
  const osrmUrl = `https://router.project-osrm.org/base/v1/driving/${lng},${lat};${state.startLatLng.lng},${state.startLatLng.lat}?overview=false`;
  const secureUrl = `https://corsproxy.io/?${encodeURIComponent(osrmUrl)}`;

  fetch(secureUrl)
    .then(r => r.json())
    .then(data => {
      if (data.code === 'Ok' && data.routes?.length > 0) {
        const mins = Math.round(data.routes[0].duration / 60) || 1;
        etaText.innerHTML = `🏍️ Llegando en aprox. ${mins} min...`;
      } else {
        throw new Error('Fallback logic needed');
      }
    })
    .catch(() => {
      // Fallback matemático si la API falla
      const minsFallback = Math.max(1, Math.ceil(distMeters / 350));
      etaText.innerHTML = `🏍️ Llegando en aprox. ${minsFallback} min...`;
    });
}

/**
 * Listen for a driver accepting the ride (dual strategy: WebSocket + polling).
 * @param {string} rideId - Ride UUID.
 * @param {object} state - Shared app state.
 */
export function listenForDriver(rideId, state, map) {
  console.log('📡 Iniciando radar para viaje:', rideId);

  // Resetear estado del mapa al iniciar nuevo viaje
  driverMapFocused = false;
  lastRouteFetch = 0;
  if (driverRouteLayer && map) { map.removeLayer(driverRouteLayer); driverRouteLayer = null; }

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

          if (payload.new.estado === 'aceptado' || payload.new.estado === 'en_progreso' || payload.new.estado === 'esperando_pasajero') {
            if (payload.new.estado === 'aceptado') playNotificationSound();
            if (payload.new.estado === 'esperando_pasajero' && state.lastKnownEstado !== 'esperando_pasajero') playNotificationSound();
            
            const topSearch = document.getElementById('topSearchArea');
            if (topSearch) topSearch.style.display = 'none';
            
            // Reconstruir UI si no estaba ya (ej. al recargar la página en medio del viaje)
            if (!document.getElementById('shareRideBtn')) {
              showDriverAssigned(payload.new.conductor_id, state);
            }
            
            if (payload.new.estado === 'esperando_pasajero') {
              setTimeout(() => showDriverWaiting(state), 300);
            }
          } else if (payload.new.estado === 'finalizado') {
            if (window.zippyCurrentMulta > 0) {
              supabase.from('clientes').update({ multa_pendiente: 0 }).eq('id', localStorage.getItem('calmovil_cliente_id')).then();
              window.zippyCurrentMulta = 0;
            }
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
            if (driverRouteLayer && map) {
              map.removeLayer(driverRouteLayer);
              driverRouteLayer = null;
            }
          } else if (payload.new.estado === 'cancelado') {
            playNotificationSound();
            zippyAlert('⚠️ El conductor ha cancelado el servicio.', '🚫');
            cancelRide(state, map);
          }
        }

        // Live Tracking de la Moto (GPS Update)
        const activeTripStates = ['aceptado', 'esperando_pasajero', 'en_progreso'];
        if (activeTripStates.includes(payload.new.estado) && payload.new.conductor_lat && payload.new.conductor_lng && map) {
          const lat = payload.new.conductor_lat;
          const lng = payload.new.conductor_lng;

          if (!driverMarker) {
            driverMarker = L.marker([lat, lng], {
              icon: motoIcon(),
              zIndexOffset: 1000 // Siempre arriba
            }).addTo(map);
          } else {
            // Animar el movimiento suavemente (1 segundo de duración)
            animateMarker(driverMarker, [lat, lng], 1000);
          }

          updateDriverMap(lat, lng, state, map);
          updateETA(lat, lng, state);
        }
      }
    )
    .subscribe();

  // Strategy 2: Backup polling for STATE changes every 4 seconds
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
        if (data.estado === 'aceptado' || data.estado === 'en_progreso' || data.estado === 'esperando_pasajero') {
          if (data.estado === 'aceptado') playNotificationSound();
          if (data.estado === 'esperando_pasajero' && state.lastKnownEstado !== 'esperando_pasajero') playNotificationSound();
          
          if (!document.getElementById('shareRideBtn')) {
            showDriverAssigned(data.conductor_id, state);
          }
          
          if (data.estado === 'esperando_pasajero') {
            setTimeout(() => showDriverWaiting(state), 300);
          }
        } else if (data.estado === 'finalizado') {
          if (window.zippyCurrentMulta > 0) {
            supabase.from('clientes').update({ multa_pendiente: 0 }).eq('id', localStorage.getItem('calmovil_cliente_id')).then();
            window.zippyCurrentMulta = 0;
          }
          showRatingScreen(state);
        } else if (data.estado === 'cancelado') {
          playNotificationSound();
          zippyAlert('⚠️ El conductor ha cancelado el servicio.', '🚫');
          cancelRide(state, map);
        }
      }
    }
  }, 4000);

  // Strategy 3: GPS-dedicated polling every 2 seconds (NEVER killed by UI transitions)
  startGPSPoller(rideId, state, map);
}

/**
 * Dedicated GPS poller that runs independently of state polling.
 * This ensures the moto marker always updates even if WebSocket misses GPS-only changes.
 */
function startGPSPoller(rideId, state, map) {
  if (gpsPollerInterval) clearInterval(gpsPollerInterval);

  gpsPollerInterval = setInterval(async () => {
    try {
      const { data, error } = await supabase
        .from('viajes')
        .select('estado, conductor_lat, conductor_lng')
        .eq('id', rideId)
        .single();

      if (error || !data) return;

      const activeTripStates = ['aceptado', 'esperando_pasajero', 'en_progreso'];
      if (!activeTripStates.includes(data.estado)) {
        // Viaje ya no está activo, detener GPS poller
        clearInterval(gpsPollerInterval);
        gpsPollerInterval = null;
        return;
      }

      if (data.conductor_lat && data.conductor_lng && map) {
        const lat = data.conductor_lat;
        const lng = data.conductor_lng;

        if (!driverMarker) {
          driverMarker = L.marker([lat, lng], {
            icon: motoIcon(),
            zIndexOffset: 1000
          }).addTo(map);
        } else {
          animateMarker(driverMarker, [lat, lng], 1800);
        }

        updateDriverMap(lat, lng, state, map);
        updateETA(lat, lng, state);
      }
    } catch (e) {
      console.warn('[ZIPPY GPS Poller] Error:', e);
    }
  }, 2000);
}

/**
 * Show the driver assigned UI with Interleaved Carousel (Sliding Windows).
 * @param {string} driverId - Driver UUID.
 * @param {object} state - Shared app state.
 */
async function showDriverAssigned(driverId, state) {
  // Solo limpiar el polling de ESTADO, NO el GPS poller
  if (state.pollerInterval) {
    clearInterval(state.pollerInterval);
    state.pollerInterval = null;
  }

  // Limpiar carrusel previo si existe
  if (state.carouselInterval) {
    clearInterval(state.carouselInterval);
    state.carouselInterval = null;
  }

  // Vista de carga inicial rápida
  document.getElementById('priceSection').innerHTML = `
    <div style="text-align:center; padding: 10px 0;">
      <h3 style="color:#30D158; margin-bottom:5px; font-weight:800;">¡Conductor Asignado!</h3>
      <div style="background:rgba(255,255,255,.05); border:1.5px solid #30D158; border-radius:12px; padding:12px; margin-bottom:10px;">
        <span style="color:rgba(255,255,255,.4); font-size:10px; display:block; text-transform:uppercase;">Conectando...</span>
      </div>
    </div>
  `;

  // Fetch datos reales a base de datos (incluyendo datos de pago)
  const { data: driver } = await supabase.from('conductores').select('nombre, placa, telefono, marca_cilindraje_color').eq('id', driverId).single();
  const { data: viajeInfo } = await supabase.from('viajes').select('tarifa, pago_wompi, codigo_viaje, bono_usado').eq('id', state.currentRideId).single();
  const tarifa = viajeInfo?.tarifa || 0;
  const isPaid = viajeInfo?.pago_wompi === true;
  const bono = viajeInfo?.bono_usado || 0;
  const saldoFinal = tarifa - bono;

  // Fetch rating promedio
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

  const driverName = driver ? driver.nombre : 'Conductor asignado';
  const driverDetails = {
    placa: driver?.placa || '---',
    vehiculo: driver?.marca_cilindraje_color || 'Moto',
    telefono: driver?.telefono || ''
  };

  // Frases de Seguridad y Motivación
  const phrases = [
    { icon: '🚩', text: 'Verifica la placa antes de subir', sub: 'Seguridad Ante Todo' },
    { icon: '✨', text: '¡Hoy será un gran día!', sub: 'Motivación Zippy' },
    { icon: '🛡️', text: 'Usa el casco bien abrochado', sub: 'Seguridad Ante Todo' },
    { icon: '🚀', text: '¡Vas por tus sueños!', sub: 'Motivación Zippy' },
    { icon: '🧤', text: 'Sujétate bien durante el viaje', sub: 'Seguridad Ante Todo' },
    { icon: '💪', text: '¡Eres imparable!', sub: 'Motivación Zippy' }
  ];

  // Generar HTML de la Ficha del Conductor (Ventana Base)
  const renderPaymentOptions = () => {
    const container = document.getElementById('wompiContainer');
    if (!container) return;

    if (isPaid) {
      container.innerHTML = '<div style="color:#30D158; font-weight:bold; background:rgba(48,209,88,.1); padding:10px; border-radius:10px; border:1px solid rgba(48,209,88,.3);">✅ PAGADO POR WOMPI</div>';
      return;
    }

    let buttonsHtml = '';
    if (state.selectedPaymentMethod === 'wompi') {
      buttonsHtml = `
        <button id="wompiPayBtn" style="width:100%;padding:14px;border-radius:14px;font-weight:900;font-size:15px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;letter-spacing:.3px;transition:transform .2s,filter .2s;">
          💳 Total a Pagar ($${saldoFinal.toLocaleString('es-CO')})
        </button>
      `;
    } else {
      buttonsHtml = `
        <div style="color:#FFB347; font-weight:bold; background:rgba(255,179,71,.1); padding:12px; border-radius:12px; border:1px solid rgba(255,179,71,.3); display:flex; flex-direction:column; gap:8px;">
          <span>💵 PAGO EN EFECTIVO AL FINALIZAR ($${saldoFinal.toLocaleString('es-CO')})</span>
        </div>
      `;
    }

    container.innerHTML = `
      <style>
        @keyframes shimmer{0%{background-position:-200% center}100%{background-position:200% center}}
        #wompiPayBtn{animation:shimmer 2.5s linear infinite;background:linear-gradient(90deg,#1a1a2e,#6c47ff,#c850c0,#6c47ff,#1a1a2e);background-size:300% auto;color:#fff;border:none;}
        #wompiPayBtn:hover{transform:scale(1.02);filter:brightness(1.15);}
      </style>
      
      ${bono > 0 ? `
        <div style="background:rgba(52,152,219,0.1); border:1px solid rgba(52,152,219,0.3); border-radius:10px; padding:8px; margin-bottom:10px; font-size:11px; color:#3498DB; font-weight:700;">
          🎁 Bono aplicado: -$${bono.toLocaleString('es-CO')}
        </div>
      ` : ''}

      ${buttonsHtml}
    `;

    const wompiBtn = document.getElementById('wompiPayBtn');
    if (wompiBtn) {
      wompiBtn.onclick = () => {
        initWompiCheckout(state.currentRideId, saldoFinal, viajeInfo?.codigo_viaje || 'VIAJE');
      };
    }
  };

  const rideCodeBadgeHTML = `
    <div style="display:flex; justify-content:center; margin-bottom:12px;">
      <div style="background:rgba(255,107,0,.15); border:1px solid rgba(255,107,0,.3); border-radius:12px; padding:8px 20px; display:flex; align-items:center; gap:12px; box-shadow:0 4px 15px rgba(255,107,0,0.15);">
        <div style="text-align:right;">
          <span style="color:rgba(255,255,255,.5); font-size:9px; text-transform:uppercase; font-weight:800; display:block;">Código del Viaje</span>
          <span style="color:#FF6B00; font-size:18px; font-weight:900; letter-spacing:2px; text-shadow:0 0 10px rgba(255,107,0,.4);">#${state.rideCode || 'ZIPPY'}</span>
        </div>
        <button id="copyCodeBtn" onclick="(function(){navigator.clipboard.writeText('${state.rideCode || 'ZIPPY'}').then(function(){var b=document.getElementById('copyCodeBtn');b.innerHTML='✅';b.style.background='rgba(48,209,88,.2)';b.style.borderColor='rgba(48,209,88,.5)';b.style.color='#30D158';setTimeout(function(){b.innerHTML='📋';b.style.background='rgba(255,255,255,.1)';b.style.borderColor='rgba(255,255,255,.2)';b.style.color='#fff';},2000);})})()" style="background:rgba(255,255,255,.1); border:1px solid rgba(255,255,255,.2); color:#fff; font-size:16px; padding:8px; border-radius:8px; cursor:pointer; transition:all .2s; display:flex; align-items:center; justify-content:center;" title="Copiar código">📋</button>
      </div>
    </div>
  `;

  const conductorWindowHTML = `
    <div class="zippy-window">
      <div style="background:rgba(255,255,255,.03); border:1px solid rgba(48,209,88,0.2); border-radius:16px; padding:15px; box-shadow: 0 4px 20px rgba(0,0,0,0.2); height:auto; width:92%; margin:0 auto; box-sizing:border-box; position:relative;">
        <div style="margin-bottom:12px;">
          <span style="color:rgba(255,255,255,.4); font-size:9px; display:block; text-transform:uppercase; letter-spacing:1px; margin-bottom:2px;">Tu Conductor Asignado</span>
          <span style="color:#fff; font-size:20px; font-weight:800; display:block;">${driverName}</span>
          <span style="color:#FFD700; font-size:12px; font-weight:700; display:block; margin-top:2px;">${driverRating}</span>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; height: 70px; width: 100%;">
          <!-- Bloque Vehículo -->
          <div style="background:rgba(255,107,0,.08); border:1px solid rgba(255,107,0,.15); padding:8px; border-radius:12px; text-align:left; display:flex; flex-direction:column; justify-content:center;">
             <span style="color:rgba(255,107,0,.6); font-size:8px; display:block; text-transform:uppercase; font-weight:800; margin-bottom:1px;">Moto</span>
             <span style="color:#fff; font-size:10px; font-weight:600; display:block; margin-bottom:3px; line-height:1.1;">${driverDetails.vehiculo}</span>
             <span style="color:rgba(255,107,0,.6); font-size:8px; display:block; text-transform:uppercase; font-weight:800;">Placa</span>
             <span style="color:#FF6B00; font-size:14px; font-weight:900; display:block;">${driverDetails.placa}</span>
          </div>

          <!-- Bloque Llamada -->
          <a href="tel:${driverDetails.telefono}" style="background:#30D158; text-decoration:none; border-radius:12px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:2px; box-shadow:0 4px 15px rgba(48,209,88,0.25);">
            <span style="font-size:20px;">📞</span>
            <span style="color:#fff; font-size:10px; font-weight:900; text-transform:uppercase;">Llamar</span>
          </a>
        </div>
      </div>
    </div>
  `;

  // Crear Track Intercalado: Conductor -> Frase -> Conductor -> Frase...
  let trackHTML = '';
  phrases.forEach(p => {
    trackHTML += conductorWindowHTML;
    trackHTML += `
      <div class="zippy-window">
        <div class="zippy-phrase-card">
          <div class="zippy-phrase-icon">${p.icon}</div>
          <div class="zippy-phrase-text">${p.text}</div>
          <div class="zippy-phrase-sub">${p.sub}</div>
        </div>
      </div>
    `;
  });

  // Renderizar Estructura completa
  document.getElementById('priceSection').innerHTML = `
    <div style="text-align:center; padding: 5px 0;">
      <h3 style="color:#30D158; margin-bottom:8px; font-weight:800; font-size:16px;">¡Conductor en camino!</h3>
      
      ${rideCodeBadgeHTML}

      <div class="zippy-viewport">
        <div class="zippy-track" id="zippyTrack">
          ${trackHTML}
        </div>
      </div>

      <p id="etaText" style="color:#FFB347; font-size:14px; font-weight:bold; margin: 12px 0; background:rgba(255,255,255,.05); padding:10px; border-radius:12px;">Calculando llegada...</p>
      
      <div id="wompiContainer" style="margin-bottom: 12px;"></div>

      <!-- Botón Compartir Viaje (rediseñado) -->
      <button id="shareRideBtn" style="width:100%; padding:13px; border-radius:16px; font-weight:800; font-size:13px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:10px; margin-bottom:10px; background:linear-gradient(135deg,rgba(99,102,241,0.18),rgba(168,85,247,0.18)); border:1.5px solid rgba(139,92,246,0.45); color:#c084fc; transition:all .2s; box-shadow:0 4px 15px rgba(139,92,246,0.12);">
        🔗 Compartir Viaje
      </button>

      <!-- Botón Cancelar Servicio (rojo pulsante, encima del juego) -->
      <style>
        @keyframes cancelServicePulse {
          0%,100% { box-shadow: 0 0 0 0 rgba(255,59,48,0.45); }
          60%      { box-shadow: 0 0 0 9px rgba(255,59,48,0); }
        }
        #cancelRideBtnAction { animation: cancelServicePulse 2s ease-in-out infinite; }
      </style>
      <button class="btn" id="cancelRideBtnAction" style="width:100%; font-size:13px; font-weight:900; background:rgba(255,59,48,0.12); color:#FF3B30; border:1.5px solid rgba(255,59,48,0.4); border-radius:14px; padding:13px; margin-bottom:10px; letter-spacing:0.4px;">
        🚫 Cancelar Servicio
      </button>

      <!-- Botón Juego -->
      <div style="margin-bottom: 15px;">
        <button id="openGameBtn" class="btn" style="background: linear-gradient(135deg, #FF6B00, #FF9500); color: #fff; width: 100%; border: none; font-weight: 800; font-size: 13px; padding: 12px; display: flex; align-items: center; justify-content: center; gap: 8px; box-shadow: 0 4px 15px rgba(255,107,0,0.3);">
            <span>🎮</span> ¿Aburrido esperando? JUEGA ZIPPY
        </button>
      </div>
    </div>
  `;

  renderPaymentOptions();

  // Init game listeners
  initGame();

  const openGameBtn = document.getElementById('openGameBtn');
  if (openGameBtn) {
    openGameBtn.onclick = () => {
      document.getElementById('zippyJumpModal').style.display = 'flex';
    };
  }

  // Control del Carrusel (Slide Left)
  const track = document.getElementById('zippyTrack');
  const slideCount = phrases.length * 2;
  let currentIndex = 0;

  state.carouselInterval = setInterval(() => {
    currentIndex = (currentIndex + 1) % slideCount;
    if (track) {
      track.style.transform = `translateX(-${currentIndex * 100}%)`;
    }
  }, 6000); // 6 segundos de exposición por ventana

  // ── Botón Compartir Viaje ──
  const shareRideBtn = document.getElementById('shareRideBtn');
  if (shareRideBtn && state.currentRideId) {
    shareRideBtn.onclick = async () => {
      const trackUrl = `https://appzippy.com/track.html?id=${state.currentRideId}`;
      const shareText = `🏍️ Estoy en un viaje con ZIPPY La Calera. Puedes seguirme en tiempo real aquí:\n${trackUrl}`;

      try {
        if (navigator.share) {
          // Native share sheet (Android/iOS)
          await navigator.share({
            title: 'Sigue mi viaje en ZIPPY',
            text: shareText,
            url: trackUrl,
          });
        } else {
          // Fallback: copy to clipboard + open WhatsApp
          await navigator.clipboard.writeText(trackUrl);
          shareRideBtn.innerHTML = '✅ ¡Link copiado!';
          shareRideBtn.style.borderColor = 'rgba(48,209,88,0.5)';
          shareRideBtn.style.color = '#30D158';
          setTimeout(() => {
            shareRideBtn.innerHTML = '🔗 Compartir viaje con familiar';
            shareRideBtn.style.borderColor = 'rgba(255,255,255,0.12)';
            shareRideBtn.style.color = 'rgba(255,255,255,0.85)';
          }, 2500);
        }
      } catch (e) {
        // If share was cancelled, do nothing
      }
    };
  }

  // Botón Cancelar (Vinculado a la base de datos para notificar al conductor)
  document.getElementById('cancelRideBtnAction').addEventListener('click', () => {
    cancelRide(state, null);
  });
}

/**
 * Modifies the driver assigned UI to show the urgent waiting warning.
 * @param {object} state - Shared app state.
 */
function showDriverWaiting(state) {
  const etaText = document.getElementById('etaText');
  if (etaText) {
    etaText.innerHTML = `🚨 ¡TU CONDUCTOR HA LLEGADO!<br><span style="font-size:12px; font-weight:normal; display:block; margin-top:5px; color:#fff;">Tienes 5 minutos para salir o el viaje se cancelará con multa.</span>`;
    etaText.style.background = 'rgba(255,59,48,0.15)';
    etaText.style.color = '#FF3B30';
    etaText.style.border = '1.5px solid rgba(255,59,48,0.5)';
    etaText.style.animation = 'cancelServicePulse 2s ease-in-out infinite';
    etaText.style.padding = '15px';
    etaText.style.lineHeight = '1.4';
  }
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

  // Fetch payment status
  supabase.from('viajes').select('tarifa, pago_wompi, codigo_viaje').eq('id', state.currentRideId).single().then(({ data }) => {
    const isPaid = data?.pago_wompi === true;
    const tarifa = data?.tarifa || 0;

    document.getElementById('priceSection').innerHTML = `
      <div style="text-align:center; padding: 15px 0;">
        <div style="font-size:40px; margin-bottom: 12px;">✨</div>
        <h3 style="color:#FF6B00; margin-bottom:10px; font-weight:800;">Viaje en Progreso</h3>
        <p style="color:rgba(255,255,255,.6); font-size:13px;">Vas camino a tu destino. ¡Disfruta el viaje!</p>
        <div style="margin-top:20px; padding:10px; background:rgba(255,107,0,.1); border-radius:10px; border:1px solid rgba(255,107,0,.2); margin-bottom:15px;">
          <span style="color:#FF6B00; font-weight:bold;">Estado:</span> Ya estás en la moto.
          <div style="margin-top:5px; font-size:11px; opacity:0.6; font-weight:900; color:#30D158;">SERVICIO #${state.rideCode || '-'}</div>
        </div>
        <div id="wompiContainerTrip" style="margin-bottom: 15px;">
          ${isPaid ?
        '<div style="color:#30D158; font-weight:bold; background:rgba(48,209,88,.1); padding:10px; border-radius:10px; border:1px solid rgba(48,209,88,.3);">✅ PAGADO POR WOMPI</div>' :
        `<style>
          @keyframes shimmerTrip{0%{background-position:-200% center}100%{background-position:200% center}}
          @keyframes cashPulseTrip{0%,100%{box-shadow:0 4px 15px rgba(48,209,88,0.2)}50%{box-shadow:0 4px 30px rgba(48,209,88,0.55)}}
          #wompiPayBtnTrip{animation:shimmerTrip 2.5s linear infinite;background:linear-gradient(90deg,#1a1a2e,#6c47ff,#c850c0,#6c47ff,#1a1a2e);background-size:300% auto;color:#fff;border:none;}
          #wompiPayBtnTrip:hover{transform:scale(1.02);filter:brightness(1.15);}
          #cashPayBtnTrip{animation:cashPulseTrip 2.5s ease infinite;}
          #cashPayBtnTrip:hover{transform:scale(1.02);}
        </style>
        <button id="wompiPayBtnTrip" style="width:100%;padding:14px;border-radius:14px;font-weight:900;font-size:15px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;transition:transform .2s,filter .2s;">
          💳 Realizar Pago ($${tarifa.toLocaleString('es-CO')})
        </button>
        <button id="cashPayBtnTrip" style="width:100%;padding:13px;border-radius:14px;font-weight:800;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;margin-top:10px;background:rgba(48,209,88,.12);border:1.5px solid rgba(48,209,88,.35);color:#30D158;transition:transform .2s;">
          💵 Pagar en Efectivo ($${tarifa.toLocaleString('es-CO')})
        </button>`
      }
        </div>
      </div>
    `;

    const wompiBtnTrip = document.getElementById('wompiPayBtnTrip');
    if (wompiBtnTrip) {
      wompiBtnTrip.onclick = () => {
        initWompiCheckout(state.currentRideId, tarifa, data?.codigo_viaje || 'VIAJE');
      };
    }

    const cashBtnTrip = document.getElementById('cashPayBtnTrip');
    if (cashBtnTrip) {
      cashBtnTrip.onclick = () => {
        // Registrar en BD que pagó en efectivo
        supabase.from('viajes').update({ pago_efectivo_confirmado: true }).eq('id', state.currentRideId).then();
        document.getElementById('wompiContainerTrip').innerHTML = '<div style="color:#FFB347; font-weight:bold; background:rgba(255,179,71,.1); padding:10px; border-radius:10px; border:1px solid rgba(255,179,71,.3); text-align:center;">💵 PAGO EN EFECTIVO AL FINALIZAR</div>';
      };
    }
  });
}

/**
 * Handle Wompi Checkout Widget opening and success callbacks.
 */
async function initWompiCheckout(viajeId, tarifa, rideCode) {
  if (typeof WidgetCheckout !== 'function') {
    zippyAlert('El sistema de pagos no ha cargado aún. Intenta de nuevo.', '⚠️');
    return;
  }

  const currency = 'COP';
  const amountInCents = tarifa * 100; // Wompi expects cents
  const reference = `ZIPPY_${rideCode}_${Date.now()}`;
  const secret = 'test_integrity_ESw0LTbced5TdxOxtkBlvPzfaDBFtX5T';

  // Generar firma de integridad requerida por Wompi
  const message = reference + amountInCents + currency + secret;
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  var checkout = new WidgetCheckout({
    currency: currency,
    amountInCents: amountInCents,
    reference: reference,
    publicKey: 'pub_test_0uLX5b7sUNR0Dw4hrWEuK0e53RYZqPn4',
    signature: { integrity: hashHex }
  });

  checkout.open(function (result) {
    var transaction = result.transaction;
    if (transaction.status === 'APPROVED') {
      // Actualizar en base de datos
      supabase.from('viajes').update({ pago_wompi: true }).eq('id', viajeId).then(({ error }) => {
        if (!error) {
          zippyAlert('¡Tu viaje ha sido pagado exitosamente!', '✅');
          // Ocultar botón y mostrar badge de pagado
          const btns = [document.getElementById('wompiContainer'), document.getElementById('wompiContainerTrip')];
          btns.forEach(c => {
            if (c) c.innerHTML = '<div style="color:#30D158; font-weight:bold; background:rgba(48,209,88,.1); padding:10px; border-radius:10px; border:1px solid rgba(48,209,88,.3);">✅ PAGADO POR WOMPI</div>';
          });
        } else {
          zippyAlert('Pago aprobado, pero hubo un error al sincronizar. Muestra tu comprobante al conductor.', '⚠️');
        }
      });
    } else {
      zippyAlert('El pago no pudo ser procesado o fue cancelado. (' + transaction.status + ')', '❌');
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
    }, 3000);
  }

  // Show notification
  zippyAlert('El conductor ha tenido un inconveniente y canceló el servicio. Te hemos regresado a la búsqueda automática de otro conductor.', '⚠️');

  // Revert UI to searching mode with native CSS Radar
  document.getElementById('priceSection').innerHTML = `
      <div id="searchingContainer" style="text-align:center; padding: 20px 0;">
        <div class="premium-radar">
          <div class="radar-moto-icon">🏍️</div>
        </div>
        <h3 style="color:#FF6B00; margin-bottom:12px; font-weight:800; font-size:20px;">Re-buscando conductor...</h3>
        <p style="color:rgba(255,255,255,.6); font-size:13px; line-height:1.5; padding:0 20px;">Estamos avisando a los conductores cercanos nuevamente. No cierres esta ventana.</p>
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

  // Ocultar el precio/búsqueda en el sidebar para limpiarlo visualmente
  const priceSection = document.getElementById('priceSection');
  if (priceSection) priceSection.innerHTML = '';

  const overlay = document.createElement('div');
  overlay.id = 'passengerRatingOverlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.88);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;';
  overlay.innerHTML = `
    <div style="background:#1c1c1e;border-radius:24px;padding:30px;max-width:340px;width:100%;text-align:center;border:1px solid rgba(255,107,0,.3);box-shadow:0 10px 40px rgba(0,0,0,0.5);">
      <div style="font-size:45px; margin-bottom:10px;">🏁</div>
      <h3 style="color:#FF6B00; margin-bottom:5px; font-weight:800;">¡Viaje Finalizado!</h3>
      <p style="color:rgba(255,255,255,.6); font-size:13px; margin-bottom:20px;">¿Cómo fue tu experiencia con el conductor?</p>
      <div id="starRatingUser" style="display:flex; justify-content:center; gap:10px; font-size:38px; cursor:pointer; margin-bottom:10px;">
        <span data-star="1" style="filter:grayscale(1) opacity(.4); transition:all 0.2s;">⭐</span>
        <span data-star="2" style="filter:grayscale(1) opacity(.4); transition:all 0.2s;">⭐</span>
        <span data-star="3" style="filter:grayscale(1) opacity(.4); transition:all 0.2s;">⭐</span>
        <span data-star="4" style="filter:grayscale(1) opacity(.4); transition:all 0.2s;">⭐</span>
        <span data-star="5" style="filter:grayscale(1) opacity(.4); transition:all 0.2s;">⭐</span>
      </div>
      <div id="ratingLabelUser" style="color:#FF6B00; font-weight:bold; font-size:13px; min-height:20px; margin-bottom:15px;"></div>
      <button id="submitRatingUserBtn" class="btn btn-primary" style="width:100%; font-size:15px; padding:14px; opacity:.5; border-radius:12px;" disabled>Enviar Calificación</button>
      <button id="skipRatingUserBtn" class="btn" style="display:block; width:100%; margin-top:12px; background:none; border:none; color:rgba(255,255,255,.4); font-size:13px; padding:8px;">Omitir</button>
    </div>
  `;

  document.body.appendChild(overlay);

  let selectedRating = 0;
  const stars = overlay.querySelectorAll('#starRatingUser span');
  const submitBtn = overlay.querySelector('#submitRatingUserBtn');
  const label = overlay.querySelector('#ratingLabelUser');
  const texts = ['', 'Muy malo 😞', 'Malo 😕', 'Regular 😐', 'Bueno 😊', 'Excelente 🤩'];

  stars.forEach(star => {
    star.addEventListener('click', () => {
      selectedRating = parseInt(star.dataset.star);
      stars.forEach((s, i) => {
        if (i < selectedRating) {
          s.style.filter = 'none';
          s.style.transform = 'scale(1.1)';
        } else {
          s.style.filter = 'grayscale(1) opacity(.4)';
          s.style.transform = 'scale(1)';
        }
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

    if (rideId) {
      const { error } = await supabase
        .from('viajes')
        .update({ calificacion: selectedRating })
        .eq('id', rideId);

      if (error) {
        console.error('Error al guardar calificación:', error);
        zippyAlert('No se pudo guardar la calificación: ' + (error.message || 'Error de permisos'), '❌');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Reintentar Enviar';
        return;
      }
    }

    localStorage.removeItem(STORAGE_KEY);
    location.reload();
  });

  overlay.querySelector('#skipRatingUserBtn').addEventListener('click', () => {
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
  });
}

/**
 * Stops all listeners (polling and websocket) and cleans up the map.
 * @param {object} state 
 */
export function stopListening(state, map) {
  if (state.pollerInterval) {
    clearInterval(state.pollerInterval);
    state.pollerInterval = null;
  }

  // Detener GPS poller dedicado
  if (gpsPollerInterval) {
    clearInterval(gpsPollerInterval);
    gpsPollerInterval = null;
  }

  if (rideChannel) {
    supabase.removeChannel(rideChannel);
    rideChannel = null;
  }

  if (driverMarker && map) {
    map.removeLayer(driverMarker);
    driverMarker = null;
    console.log('[ZIPPY] Limpiando marcador de conductor.');
  }

  if (driverRouteLayer && map) {
    map.removeLayer(driverRouteLayer);
    driverRouteLayer = null;
    console.log('[ZIPPY] Limpiando ruta del conductor.');
  }
}

/**
 * Cancel the current ride request.
 * @param {object} state - Shared app state.
 * @param {L.Map} map - Leaflet map instance.
 */
export async function cancelRide(state, map) {
  // Solo pedir confirmación si realmente se está cancelando activamente
  // (Si viene de un alert de "conductor canceló", ya se llamó stopListening)

  stopListening(state, map);
  if (state.currentRideId) {
    let viaje = null;
    // ── Devolver bono si el viaje tenía uno aplicado ──
    try {
      const { data } = await supabase
        .from('viajes')
        .select('bono_usado, pasajero_id, pago_wompi, estado')
        .eq('id', state.currentRideId)
        .single();
      
      viaje = data;

      if (viaje?.bono_usado > 0 && viaje?.pasajero_id) {
        const { data: cliente } = await supabase
          .from('clientes')
          .select('saldo_bono')
          .eq('id', viaje.pasajero_id)
          .single();

        const saldoRestaurado = (cliente?.saldo_bono || 0) + viaje.bono_usado;

        await supabase
          .from('clientes')
          .update({ saldo_bono: saldoRestaurado })
          .eq('id', viaje.pasajero_id);

        // Actualizar UI local también
        window.zippyCurrentBono = saldoRestaurado;
        console.log(`[ZIPPY] Bono devuelto: $${viaje.bono_usado.toLocaleString('es-CO')}`);
      }
    } catch (e) {
      console.warn('[ZIPPY] No se pudo procesar la info extra al cancelar:', e);
    }

    localStorage.removeItem(STORAGE_KEY);
    await supabase.from('viajes').update({ estado: 'cancelado' }).eq('id', state.currentRideId);

    // ── MULTA POR CANCELACIÓN TARDÍA (1.500 COP para Zippy) ──
    if (viaje?.pasajero_id && (viaje.estado === 'aceptado' || viaje.estado === 'en_progreso')) {
      try {
        const { data: clienteData } = await supabase
          .from('clientes')
          .select('multa_pendiente')
          .eq('id', viaje.pasajero_id)
          .single();
        
        const nuevaMulta = (clienteData?.multa_pendiente || 0) + 1500;
        
        await supabase
          .from('clientes')
          .update({ multa_pendiente: nuevaMulta })
          .eq('id', viaje.pasajero_id);
          
        window.zippyCurrentMulta = nuevaMulta; // Cache local
        
        await zippyAlert(
          'Cancelaste el viaje cuando el conductor ya estaba asignado. Se aplicará un recargo de $1.500 en tu próximo viaje por políticas de Zippy.',
          '⚠️',
          'Aviso de Cancelación'
        );
      } catch (err) {
        console.error('[ZIPPY] Error aplicando multa de cancelación:', err);
      }
    }

    // ── Si pagó por Wompi, avisar sobre devoluciones antes de recargar ──
    if (viaje?.pago_wompi === true) {
      await zippyAlert(
        '⚠️ Tu pago por Wompi fue registrado. Para solicitar una devolución por esta cancelación, comunícate con Soporte ZIPPY por WhatsApp.',
        '💳',
        'Devolución por Cancelación'
      );
    }
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
    if (data.estado === 'cancelado' || (data.estado === 'finalizado' && data.calificacion)) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }

    // 1. Restaurar Estado Base
    state.currentRideId = data.id;
    state.lastKnownEstado = data.estado;
    state.rideCode = data.codigo_viaje;

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
    } else if (data.estado === 'finalizado') {
      showRatingScreen(state);
      document.getElementById('priceSection').style.display = 'block';
    }

    // 4. Reconectar radares
    listenForDriver(state.currentRideId, state, map);

  } catch (err) {
    console.error('Error al restaurar viaje:', err);
    localStorage.removeItem(STORAGE_KEY);
  }
}
