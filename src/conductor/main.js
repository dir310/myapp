/**
 * Conductor page entry point — wires all modules together.
 */
import '../styles/common.css';
import '../styles/conductor.css';

import { toggleRadar, playAlert } from './ui.js';
import { loadViajes, setupRealtimeChannel } from './realtime.js';
import { zippyDanger } from '../utils/ui-global.js';
import './game.js';


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


