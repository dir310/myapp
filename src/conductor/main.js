/**
 * Conductor page entry point — wires all modules together.
 */
import '../styles/common.css';
import '../styles/conductor.css';

import { toggleRadar, playAlert } from './ui.js';
import { loadViajes, setupRealtimeChannel } from './realtime.js';
import { zippyDanger } from '../utils/ui-global.js';
import { supabase } from '../config/supabase.js';
import './game.js';

async function checkGlobalBanner() {
  try {
    const today = new Date().toDateString();
    const lastSeen = localStorage.getItem('zippy_global_banner_last_seen');
    if (lastSeen === today) return; // Ya se mostró hoy

    const { data } = await supabase.from('mensajes_globales').select('*').eq('activo', true).limit(1).single();
    if (data && data.titulo && data.mensaje) {
      const banner = document.createElement('div');
      banner.id = 'globalMessageBanner';
      banner.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.85); z-index:999999; display:flex; align-items:center; justify-content:center; animation: fadeIn 0.4s; padding:20px;';
      banner.innerHTML = `
        <div style="background:linear-gradient(135deg, #1c1c1e, #2c2c2e); padding:30px 20px; border-radius:20px; text-align:center; max-width:350px; border: 2px solid #3498DB; box-shadow: 0 10px 30px rgba(52,152,219,0.3); position:relative;">
            <div style="font-size:40px; margin-bottom:10px;">📢</div>
            <h2 style="color:#3498DB; margin:0 0 10px 0; font-weight:900;">${data.titulo}</h2>
            <p style="color:rgba(255,255,255,0.9); font-size:15px; margin-bottom:20px; line-height:1.5;">${data.mensaje}</p>
            <button id="dismissGlobalBannerDriverBtn" 
                    style="background:#3498DB; color:white; border:none; padding:12px 20px; border-radius:12px; font-weight:800; font-size:15px; cursor:pointer; width:100%; box-shadow: 0 4px 15px rgba(52,152,219,0.4);">
                ¡Entendido! 👍
            </button>
        </div>
      `;
      document.body.appendChild(banner);

      const dismissBtn = banner.querySelector('#dismissGlobalBannerDriverBtn');
      if (dismissBtn) {
        dismissBtn.onclick = () => {
          localStorage.setItem('zippy_global_banner_last_seen', today);
          banner.remove();
        };
      }
    }
  } catch (e) {
    // ignore
  }
}

document.addEventListener('DOMContentLoaded', checkGlobalBanner);


// ── Event Listeners ──
document.getElementById('radarBtn').addEventListener('click', toggleRadar);

// Refrescar viajes instantáneamente al volver de Waze u otras apps
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    loadViajes();
  }
});

// ── Initialize ──
import { initAuth } from './auth.js';
initAuth();

// ── Register Service Worker (PWA) ──
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register(new URL('/conductor/sw.js', import.meta.url).href).catch(console.log);
}

// ── Modal Acerca de ZIPPY (Conductor) ──
const openDriverAboutBtn = document.getElementById('openDriverAboutBtn');
const driverAboutOverlay = document.getElementById('driverAboutOverlay');
const closeDriverAboutBtn = document.getElementById('closeDriverAboutBtn');

if (openDriverAboutBtn) {
  openDriverAboutBtn.addEventListener('click', () => {
    if (driverAboutOverlay) driverAboutOverlay.style.display = 'flex';
  });
}

if (closeDriverAboutBtn) {
  closeDriverAboutBtn.addEventListener('click', () => {
    if (driverAboutOverlay) driverAboutOverlay.style.display = 'none';
  });
}

// ── Swipe derecha para cerrar el sidebar del perfil ──
(function initSwipeToCloseProfile() {
  const sidebar = document.getElementById('profileSidebar');
  if (!sidebar) return;

  let touchStartX = 0;
  let touchStartY = 0;
  const SWIPE_THRESHOLD = 60; // px mínimos hacia la derecha para cerrar
  const ANGLE_THRESHOLD = 35; // grados max de desviación vertical

  sidebar.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });

  sidebar.addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = Math.abs(e.changedTouches[0].clientY - touchStartY);
    const angle = Math.atan2(dy, Math.abs(dx)) * (180 / Math.PI);

    // Swipe hacia la derecha, suficientemente horizontal
    if (dx > SWIPE_THRESHOLD && angle < ANGLE_THRESHOLD) {
      sidebar.classList.remove('open');
    }
  }, { passive: true });
})();

// ── Wake Lock: Mantener pantalla encendida (Conductor) ──
let wakeLock = null;
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      console.log('🔆 Pantalla activa (Wake Lock ON)');
      wakeLock.addEventListener('release', () => {
        console.log('💤 Wake Lock liberado');
      });
    }
  } catch (err) {
    console.log('Wake Lock no disponible:', err.message);
  }
}
requestWakeLock();
// Reactivar al volver a la app (cambio de pestaña o multitarea)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') requestWakeLock();
});

// ── Viajes Agendados (Conductor) ──────────────────────────────────────────────
import { getCurrentProfile } from './auth.js';
import { zippyAlert, zippyConfirm } from '../utils/ui-global.js';

async function loadAgendados() {
  const el = document.getElementById('agendadosList');
  if (!el) return;
  el.innerHTML = `<div class="empty-state" style="padding:30px 0;"><div style="font-size:32px;opacity:.3;">⏳</div><p style="font-size:13px;color:rgba(255,255,255,.4);margin-top:8px;">Cargando...</p></div>`;

  try {
    const profile = await getCurrentProfile();
    const profileId = profile?.id || null;

    const { data, error } = await supabase
      .from('viajes_agendados')
      .select('*')
      .in('estado', ['pendiente', 'aceptado', 'en_curso'])
      .order('fecha_hora', { ascending: true });

    if (error || !data || data.length === 0) {
      el.innerHTML = `<div class="empty-state" style="padding:30px 0;"><div style="font-size:40px;margin-bottom:12px;opacity:.3;">📅</div><p style="font-size:13px;color:rgba(255,255,255,.5);">No hay viajes agendados próximos.</p></div>`;
      return;
    }

    // Filtrar viajes disponibles (pendiente) o asignados al conductor actual
    const filtered = data.filter(v => {
      if (v.estado === 'pendiente') return true;
      if ((v.estado === 'aceptado' || v.estado === 'en_curso') && profileId && v.conductor_id === profileId) return true;
      return false;
    });

    // Enrich missing passenger info from clientes table if needed
    for (let v of filtered) {
      if ((!v.pasajero_nombre || !v.pasajero_telefono) && v.pasajero_id) {
        try {
          const { data: cData } = await supabase.from('clientes').select('nombre, telefono').eq('id', v.pasajero_id).maybeSingle();
          if (cData) {
            if (!v.pasajero_nombre && cData.nombre) v.pasajero_nombre = cData.nombre;
            if (!v.pasajero_telefono && cData.telefono) v.pasajero_telefono = cData.telefono;
          }
        } catch (_) {}
      }
    }

    if (filtered.length === 0) {
      el.innerHTML = `<div class="empty-state" style="padding:30px 0;"><div style="font-size:40px;margin-bottom:12px;opacity:.3;">📅</div><p style="font-size:13px;color:rgba(255,255,255,.5);">No hay viajes agendados próximos.</p></div>`;
      return;
    }

    el.innerHTML = filtered.map(v => {
      const fechaStr = new Date(v.fecha_hora).toLocaleString('es-CO', { dateStyle: 'full', timeStyle: 'short' });
      const isAccepted = v.estado === 'aceptado' || v.estado === 'en_curso';
      const isEnCurso = v.estado === 'en_curso';
      const isMine = profileId && v.conductor_id === profileId;
      const badgeColor = isEnCurso ? '#30D158' : (isAccepted ? (isMine ? '#30D158' : '#FF9500') : '#FF6B00');
      const badgeText = isEnCurso ? '🚕 En Recogida / En Curso' : (isAccepted ? (isMine ? '✅ Aceptado (Tú)' : '🔒 Tomado') : '⏳ Disponible');

      const pagoBadge = v.pagado
        ? '<span style="font-size:11px;font-weight:800;color:#30D158;background:rgba(48,209,88,0.15);padding:3px 8px;border-radius:10px;border:1px solid rgba(48,209,88,0.3);">💳 Pagado por Wompi</span>'
        : '<span style="font-size:11px;font-weight:800;color:#FF9500;background:rgba(255,149,0,0.15);padding:3px 8px;border-radius:10px;border:1px solid rgba(255,149,0,0.3);">⏳ Pendiente de Pago (Efectivo)</span>';

      const pasNombre = v.pasajero_nombre || 'Pasajero ZIPPY';
      const pasTel = v.pasajero_telefono || '';
      const cleanTel = pasTel.replace(/[^0-9]/g, '');

      const passengerBlock = `
      <div style="background:rgba(255,255,255,.05);padding:10px 12px;border-radius:12px;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;border:1px solid rgba(255,255,255,0.08);">
        <div style="display:flex;align-items:center;gap:10px;">
          <div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#FF6B00,#FF9500);display:flex;align-items:center;justify-content:center;font-size:18px;color:#fff;font-weight:900;box-shadow:0 3px 10px rgba(255,107,0,0.3);">👤</div>
          <div>
            <div style="color:#fff;font-weight:800;font-size:13px;">${pasNombre}</div>
            <div style="color:rgba(255,255,255,0.5);font-size:11px;">📱 ${pasTel || 'Sin teléfono registrado'}</div>
          </div>
        </div>
        ${cleanTel ? `
          <div style="display:flex;gap:6px;">
            <a href="https://wa.me/57${cleanTel}?text=Hola%20${encodeURIComponent(pasNombre)},%20soy%20tu%20conductor%20de%20ZIPPY" target="_blank" style="background:#25D366;color:#fff;text-decoration:none;padding:6px 10px;border-radius:8px;font-size:11px;font-weight:800;display:flex;align-items:center;gap:4px;">💬 WhatsApp</a>
            <a href="tel:${pasTel}" style="background:#007AFF;color:#fff;text-decoration:none;padding:6px 10px;border-radius:8px;font-size:11px;font-weight:800;display:flex;align-items:center;gap:4px;">📞 Llamar</a>
          </div>
        ` : ''}
      </div>`;

      return `
      <div style="background:rgba(255,255,255,.04);border:1px solid ${isEnCurso ? 'rgba(48,209,88,0.4)' : 'rgba(255,255,255,.08)'};border-radius:16px;padding:16px;margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <span style="font-size:11px;font-weight:700;color:${badgeColor};background:rgba(255,255,255,.05);padding:4px 10px;border-radius:20px;border:1px solid ${badgeColor}40;">${badgeText}</span>
          <span style="font-size:20px;font-weight:900;color:#FF6B00;">$${(v.tarifa||0).toLocaleString('es-CO')}</span>
        </div>
        <div style="margin-bottom:10px;">${pagoBadge}</div>
        ${passengerBlock}
        <div style="font-size:12px;color:rgba(255,255,255,.4);margin-bottom:4px;">📅 ${fechaStr}</div>
        <div style="font-size:13px;color:rgba(255,255,255,.85);margin-bottom:3px;">📍 <strong>Recogida:</strong> ${v.origen}</div>
        <div style="font-size:13px;color:rgba(255,255,255,.85);margin-bottom:12px;">🏁 <strong>Destino:</strong> ${v.destino}</div>
        <div style="font-size:11px;color:rgba(255,255,255,.3);margin-bottom:10px;">Código: #${v.codigo_viaje} · ${v.distancia_km} km</div>
        
        <button onclick="verRutaAgendadoInMap(${v.origen_lat}, ${v.origen_lng}, ${v.destino_lat}, ${v.destino_lng})" style="width:100%;padding:10px;border-radius:10px;font-weight:800;font-size:12px;cursor:pointer;background:rgba(255,107,0,0.15);color:#FF6B00;border:1px solid rgba(255,107,0,0.4);margin-bottom:8px;display:flex;align-items:center;justify-content:center;gap:6px;">🗺️ Ver Ruta en el Mapa</button>

        ${!isAccepted ? `
          <button onclick="aceptarAgendado('${v.id}')" style="width:100%;padding:12px;border-radius:12px;font-weight:800;font-size:14px;cursor:pointer;background:linear-gradient(135deg,#30D158,#28b84d);color:#000;border:none;margin-bottom:6px;">✅ Aceptar Viaje</button>
        ` : (isMine && isEnCurso) ? `
          <div style="display:flex;flex-direction:column;gap:6px;margin-top:6px;">
            <button onclick="abrirWazeDestino(${v.destino_lat}, ${v.destino_lng})" style="width:100%;padding:12px;border-radius:12px;font-weight:900;font-size:13px;cursor:pointer;background:#33CCFF;color:#000;border:none;display:flex;align-items:center;justify-content:center;gap:6px;box-shadow:0 4px 15px rgba(51,204,255,0.3);">🏁 Ir a Destino (Waze)</button>
            <div style="display:flex;gap:6px;">
              <button onclick="abrirWazeAgendado(${v.origen_lat}, ${v.origen_lng})" style="flex:1;padding:10px;border-radius:10px;font-weight:800;font-size:11.5px;cursor:pointer;background:rgba(255,255,255,0.08);color:#fff;border:1px solid rgba(255,255,255,0.15);">📍 Waze Origen</button>
              <button onclick="finalizarAgendado('${v.id}')" style="flex:1.4;padding:10px;border-radius:10px;font-weight:900;font-size:12px;cursor:pointer;background:linear-gradient(135deg,#30D158,#28b84d);color:#000;border:none;">✅ Finalizar Viaje</button>
            </div>
          </div>
        ` : (isMine && !isEnCurso) ? `
          <div style="display:flex;gap:8px;margin-top:6px;">
            <button onclick="iniciarViajeAgendado('${v.id}')" style="flex:1.3;padding:12px 6px;border-radius:12px;font-weight:900;font-size:13px;cursor:pointer;background:linear-gradient(135deg,#30D158,#28b84d);color:#000;border:none;box-shadow:0 4px 15px rgba(48,209,88,0.4);display:flex;align-items:center;justify-content:center;gap:4px;">🚕 Recoger Ya</button>
            <button onclick="cancelarAgendado('${v.id}')" style="flex:1;padding:12px 6px;border-radius:12px;font-weight:800;font-size:13px;cursor:pointer;background:rgba(255,59,48,.1);color:#FF3B30;border:1px solid rgba(255,59,48,.4);">❌ Liberar</button>
          </div>
        ` : ''}
      </div>`;
    }).join('');
  } catch (e) {
    console.error('[ZIPPY] Error al cargar agendados conductor:', e);
    el.innerHTML = `<div class="empty-state" style="padding:30px 0;"><div style="font-size:40px;margin-bottom:12px;opacity:.3;">📅</div><p style="font-size:13px;color:rgba(255,255,255,.5);">No hay viajes agendados próximos.</p></div>`;
  }
}

window.loadAgendados = loadAgendados;

// Suscripción Realtime para actualizar al instante cuando un pasajero agende, cancele o modifique su viaje
try {
  supabase.channel('conductor-viajes-agendados')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'viajes_agendados' }, () => {
      loadAgendados();
    }).subscribe();
} catch (_) {}

window.aceptarAgendado = async function(id) {
  const profile = await getCurrentProfile();
  if (!profile) { zippyAlert('Debes iniciar sesión.', '⚠️'); return; }

  // Límite de 1 viaje agendado activo por conductor
  const { data: existing } = await supabase
    .from('viajes_agendados')
    .select('id')
    .eq('conductor_id', profile.id)
    .in('estado', ['aceptado', 'en_curso']);

  if (existing && existing.length > 0) {
    zippyAlert('⚠️ Ya tienes 1 viaje agendado activo. Debes completarlo o liberarlo antes de tomar otro.', '✋');
    return;
  }

  const ok = await zippyConfirm('¿Confirmas que aceptas este viaje agendado?');
  if (!ok) return;
  const { error } = await supabase.from('viajes_agendados').update({ estado: 'aceptado', conductor_id: profile.id }).eq('id', id).eq('estado', 'pendiente');
  if (error) { zippyAlert('No se pudo aceptar. Quizás otro conductor lo tomó.', '❌'); }
  loadAgendados();
};

window.iniciarViajeAgendado = async function(id) {
  const profile = await getCurrentProfile();
  if (!profile) return;

  const { data: v, error } = await supabase.from('viajes_agendados').select('*').eq('id', id).single();
  if (error || !v) { zippyAlert('Error al cargar datos del viaje.', '❌'); return; }

  const ok = await zippyConfirm('¿Deseas iniciar la recogida e ir a por el pasajero?');
  if (!ok) return;

  // Actualizar estado exclusivamente dentro de viajes_agendados
  await supabase.from('viajes_agendados').update({ estado: 'en_curso' }).eq('id', id);

  // ── Iniciar GPS en tiempo real para viaje agendado (igual que viajes normales) ──
  if (navigator.geolocation) {
    // Enviar posición inicial inmediatamente
    navigator.geolocation.getCurrentPosition(async (pos) => {
      await supabase.from('viajes_agendados').update({
        conductor_lat: pos.coords.latitude,
        conductor_lng: pos.coords.longitude
      }).eq('id', id);
    }, null, { enableHighAccuracy: true, timeout: 5000 });

    // Rastreo continuo cada segundo — igual que startGPS en viajes normales
    if (window.agendadoGpsWatchId) navigator.geolocation.clearWatch(window.agendadoGpsWatchId);
    let lastAgendadoGPS = 0;
    window.agendadoGpsWatchId = navigator.geolocation.watchPosition(
      async (pos) => {
        const now = Date.now();
        if (now - lastAgendadoGPS < 1000) return;
        lastAgendadoGPS = now;
        window.lastConductorLatLng = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        await supabase.from('viajes_agendados').update({
          conductor_lat: pos.coords.latitude,
          conductor_lng: pos.coords.longitude
        }).eq('id', id).in('estado', ['en_curso']);
      },
      (err) => console.warn('GPS Agendado Error:', err.message),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
    );
  }

  // Abrir Waze para ir por el pasajero (Origen)
  if (v.origen_lat && v.origen_lng) {
    window.open(`https://waze.com/ul?ll=${v.origen_lat},${v.origen_lng}&navigate=yes`, '_blank');
  }

  loadAgendados();
  zippyAlert('¡Viaje en curso! Navegando en Waze hacia el punto de recogida.', '🚕');
};

window.abrirWazeAgendado = function(lat, lng) {
  if (lat && lng) {
    window.open(`https://waze.com/ul?ll=${lat},${lng}&navigate=yes`, '_blank');
  }
};

window.abrirWazeDestino = function(lat, lng) {
  if (lat && lng) {
    window.open(`https://waze.com/ul?ll=${lat},${lng}&navigate=yes`, '_blank');
  } else {
    zippyAlert('No se encontraron coordenadas exactas del destino.', '⚠️');
  }
};

window.finalizarAgendado = async function(id) {
  const ok = await zippyConfirm('¿Confirmas que has recogido al pasajero y completado el viaje agendado?');
  if (!ok) return;

  await supabase.from('viajes_agendados').update({ estado: 'completado' }).eq('id', id);

  // Detener GPS del viaje agendado
  if (window.agendadoGpsWatchId) {
    navigator.geolocation.clearWatch(window.agendadoGpsWatchId);
    window.agendadoGpsWatchId = null;
  }
  loadAgendados();

  // Desplegar ventana emergente de calificación por estrellas para el conductor
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.88);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;';
  overlay.innerHTML = `
    <div style="background:#1c1c1e;border:1px solid rgba(48,209,88,0.4);border-radius:24px;padding:25px;width:100%;max-width:360px;text-align:center;box-shadow:0 10px 40px rgba(0,0,0,0.8);">
      <div style="font-size:45px;margin-bottom:10px;">🎉</div>
      <h3 style="color:#30D158;margin-bottom:8px;font-weight:900;">¡Viaje Agendado Completado!</h3>
      <p style="color:rgba(255,255,255,0.7);font-size:13px;margin-bottom:15px;">¿Cómo calificas la puntualidad y trato del pasajero?</p>
      <div id="driverRatingStars" style="font-size:36px;cursor:pointer;margin-bottom:20px;display:flex;justify-content:center;gap:8px;">
        <span onclick="this.style.transform='scale(1.2)'">⭐</span>
        <span onclick="this.style.transform='scale(1.2)'">⭐</span>
        <span onclick="this.style.transform='scale(1.2)'">⭐</span>
        <span onclick="this.style.transform='scale(1.2)'">⭐</span>
        <span onclick="this.style.transform='scale(1.2)'">⭐</span>
      </div>
      <button onclick="this.closest('div').parentElement.remove(); loadAgendados(); zippyToast('¡Calificación de viaje agendado guardada! 🏆');" style="width:100%;padding:14px;border-radius:14px;background:#30D158;color:#000;font-weight:900;font-size:15px;border:none;cursor:pointer;">✅ Guardar Calificación</button>
    </div>
  `;
  document.body.appendChild(overlay);
};

window.cancelarAgendado = async function(id) {
  const ok = await zippyConfirm('¿Confirmas que deseas liberar este viaje para que otro conductor pueda tomarlo?');
  if (!ok) return;
  await supabase.from('viajes_agendados').update({ estado: 'pendiente', conductor_id: null }).eq('id', id);
  loadAgendados();
};

window.verRutaAgendadoInMap = function(oLat, oLng, dLat, dLng) {
  if (!oLat || !oLng || !dLat || !dLng) {
    zippyAlert('No se encontraron las coordenadas exactas para esta ruta agendada.', '🗺️');
    return;
  }

  let modal = document.getElementById('agendadoRouteModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'agendadoRouteModal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.85);backdrop-filter:blur(10px);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:15px;';
    modal.innerHTML = `
      <div style="background:#141418;border:1px solid rgba(255,107,0,0.3);border-radius:24px;width:100%;max-width:500px;height:75vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,0.8);position:relative;">
        <div style="padding:14px 18px;background:rgba(255,255,255,0.03);border-bottom:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:space-between;">
          <div style="font-weight:900;color:#FF6B00;font-size:15px;display:flex;align-items:center;gap:6px;">🗺️ Ruta del Viaje Agendado</div>
          <button onclick="document.getElementById('agendadoRouteModal').style.display='none'" style="background:rgba(255,255,255,0.1);border:none;color:#fff;width:32px;height:32px;border-radius:50%;font-size:16px;font-weight:bold;cursor:pointer;">✕</button>
        </div>
        <div id="agendadoMapContainer" style="flex:1;width:100%;position:relative;background:#000;"></div>
        <div style="padding:12px;background:#141418;border-top:1px solid rgba(255,255,255,0.08);text-align:center;">
          <button onclick="document.getElementById('agendadoRouteModal').style.display='none'" style="width:100%;padding:12px;border-radius:12px;font-weight:800;font-size:14px;cursor:pointer;background:#FF6B00;color:#fff;border:none;">Cerrar Mapa</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  } else {
    modal.style.display = 'flex';
  }

  setTimeout(() => {
    if (window.agendadoModalMap) {
      try { window.agendadoModalMap.remove(); } catch (_) {}
      window.agendadoModalMap = null;
    }

    if (typeof L !== 'undefined') {
      const map = L.map('agendadoMapContainer', {
        maxZoom: 16,
        minZoom: 9
      }).setView([oLat, oLng], 13);
      window.agendadoModalMap = map;

      // Capa de Satélite HD (ESRI World Imagery)
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 17,
        attribution: 'Esri Satellite'
      }).addTo(map);

      // Nombres de calles y lugares sobre la vista satelital
      L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 17
      }).addTo(map);

      if (L.Routing && L.Routing.control) {
        L.Routing.control({
          waypoints: [
            L.latLng(oLat, oLng),
            L.latLng(dLat, dLng)
          ],
          router: L.Routing.osrmv1({ serviceUrl: 'https://router.project-osrm.org/route/v1' }),
          lineOptions: { styles: [{ color: '#FF6B00', weight: 7, opacity: 0.95 }] },
          createMarker: function(i, wp) {
            const isA = (i === 0);
            const emoji = isA ? '📍' : '🏁';
            const labelText = isA ? 'Punto A (Origen)' : 'Punto B (Destino)';
            const bgColor = isA ? '#30D158' : '#FF3B30';
            const icon = L.divIcon({
              className: 'custom-agendado-pin',
              html: `
                <div style="display:flex;flex-direction:column;align-items:center;cursor:pointer;">
                  <div style="font-size:36px;line-height:1;filter:drop-shadow(0 4px 10px rgba(0,0,0,0.9));transform:scale(1.1);">
                    ${emoji}
                  </div>
                  <div style="background:rgba(0,0,0,0.88);color:#fff;font-size:11px;font-weight:900;padding:3px 9px;border-radius:10px;margin-top:2px;white-space:nowrap;border:1.5px solid ${bgColor};box-shadow:0 3px 12px rgba(0,0,0,0.8);">
                    ${labelText}
                  </div>
                </div>
              `,
              iconSize: [60, 65],
              iconAnchor: [30, 36]
            });
            return L.marker(wp.latLng, { icon: icon });
          },
          show: false,
          addWaypoints: false
        }).addTo(map);
      } else {
        L.marker([oLat, oLng]).addTo(map).bindPopup('📍 Punto A (Origen)').openPopup();
        L.marker([dLat, dLng]).addTo(map).bindPopup('🏁 Punto B (Destino)');
      }

      map.fitBounds(L.latLngBounds([ [oLat, oLng], [dLat, dLng] ]), {
        padding: [60, 60],
        maxZoom: 15
      });
    }
  }, 200);
};


