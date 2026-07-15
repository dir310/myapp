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
            <button onclick="document.getElementById('globalMessageBanner').remove()" 
                    style="background:#3498DB; color:white; border:none; padding:12px 20px; border-radius:12px; font-weight:800; font-size:15px; cursor:pointer; width:100%; box-shadow: 0 4px 15px rgba(52,152,219,0.4);">
                ¡Entendido! 👍
            </button>
        </div>
      `;
      document.body.appendChild(banner);
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


