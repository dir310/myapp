/**
 * Conductor page UI: radar toggle and ride card rendering.
 */

let radarEnabled = false;
const alertSound = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');

/**
 * Toggle the radar (sound alerts) on/off.
 */
export function toggleRadar() {
  radarEnabled = !radarEnabled;
  const btn = document.getElementById('radarBtn');
  const txt = document.getElementById('radarText');

  if (radarEnabled) {
    btn.className = 'radar-toggle radar-on';
    txt.innerText = 'RADAR ENCENDIDO';
    // Touch sound to unlock browser audio policy
    alertSound.play().then(() => {
      alertSound.pause();
      alertSound.currentTime = 0;
    }).catch((e) => console.log('Audio unlock failed:', e));
  } else {
    btn.className = 'radar-toggle radar-off';
    txt.innerText = 'ACTIVAR RADAR (SONIDO)';
  }
}

/**
 * Returns whether radar sound is enabled.
 */
export function isRadarEnabled() {
  return radarEnabled;
}

/**
 * Play the alert sound if radar is enabled.
 */
export function playAlert() {
  if (radarEnabled) {
    alertSound.play().catch((e) => console.log('Sound error:', e));
  }
}

/**
 * Show the "new ride" notification banner briefly.
 */
export function showNewRideBanner() {
  const banner = document.getElementById('newRideBanner');
  banner.classList.add('show');
  setTimeout(() => banner.classList.remove('show'), 5000);
}

/**
 * Render the list of active rides as cards.
 * @param {Array} viajes - Array of ride objects.
 * @param {object} handlers - { onAccept, onReject } callback functions.
 */
export function renderViajes(viajes, handlers) {
  const container = document.getElementById('viajesList');

  if (viajes.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div style="font-size: 45px; margin-bottom: 15px; opacity:.3;">⏱️</div>
        Buscando pasajeros<br>cerca de La Calera...
      </div>`;
    return;
  }

  container.innerHTML = viajes
    .map(
      (v) => `
    <div class="card" id="viaje-${v.id}">
      <div class="card-header">
        <div>
          <div style="font-size:11px; color:rgba(255,255,255,.4); text-transform:uppercase; margin-bottom:2px;">Ganancia</div>
          <div class="price">$${v.tarifa.toLocaleString('es-CO')}</div>
        </div>
        <div class="dist" style="text-align:right">
          <div style="font-size:11px; color:rgba(255,255,255,.4); text-transform:uppercase; margin-bottom:2px;">Distancia</div>
          ${v.distancia_km}
        </div>
      </div>
      <div class="route-info">
        <div class="dot-text"><div class="icon-o">🟠</div><div><b>Recoger:</b><br>${v.origen_nombre}</div></div>
        <div class="dot-text"><div class="icon-d">🟢</div><div><b>Llevar a:</b><br>${v.destino_nombre}</div></div>
      </div>
      <div class="actions-row">
        <button class="btn btn-reject" data-action="reject" data-id="${v.id}">❌ Ocultar</button>
        <button class="btn btn-accept" data-action="accept" data-id="${v.id}" data-lat="${v.origen_lat}" data-lng="${v.origen_lng}">✅ ACEPTAR</button>
      </div>
    </div>
  `
    )
    .join('');

  // Attach event listeners via delegation
  container.querySelectorAll('[data-action="reject"]').forEach((btn) => {
    btn.addEventListener('click', () => handlers.onReject(btn.dataset.id));
  });

  container.querySelectorAll('[data-action="accept"]').forEach((btn) => {
    btn.addEventListener('click', () =>
      handlers.onAccept(btn.dataset.id, parseFloat(btn.dataset.lat), parseFloat(btn.dataset.lng))
    );
  });
}
