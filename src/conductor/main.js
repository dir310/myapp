/**
 * Conductor page entry point — wires all modules together.
 */
import '../styles/common.css';
import '../styles/conductor.css';

import { toggleRadar, playAlert } from './ui.js';
import { loadViajes, setupRealtimeChannel } from './realtime.js';

// ── Event Listeners ──
document.getElementById('radarBtn').addEventListener('click', toggleRadar);

// Refrescar viajes instantáneamente al volver de Waze u otras apps
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    loadViajes();
    playAlert(); // Sonar alarma al volver si el radar está encendido
  }
});

// ── Initialize ──
import { initAuth } from './auth.js';
initAuth();

// ── Register Service Worker (PWA) ──
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register(new URL('/sw.js', import.meta.url).href).catch(console.log);
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
