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
  navigator.serviceWorker.register(new URL('/sw.js', import.meta.url).href)
    .then(reg => {
      console.log('✅ Service Worker registrado');
      // Solo suscribir si el conductor entra y activa el radar
      window.setupPushNotifications = async () => {
        try {
          const permission = await Notification.requestPermission();
          if (permission !== 'granted') return;

          const publicKey = 'BOw0KEyevvCgbw7kVS9q6CsYcN2mdVWFccm8NyAnukk5KTztaUqgnPe5ubx4fD4D01mHoVnrU1WftqCZBhYxZ20';
          const subscription = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(publicKey)
          });

          const { supabase } = await import('../config/supabase.js');
          const { getCurrentProfile } = await import('./auth.js');
          const profile = getCurrentProfile();

          if (profile) {
             await supabase.from('push_subscriptions').upsert({
               conductor_id: profile.id,
               subscription: JSON.stringify(subscription)
             });
             console.log('✅ Suscripción Push guardada en DB');
          }
        } catch (err) {
          console.error('❌ Error suscripción Push:', err);
        }
      };
    })
    .catch(console.log);
}

// Helper para VAPID
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) { outputArray[i] = rawData.charCodeAt(i); }
  return outputArray;
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
