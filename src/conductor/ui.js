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
    .map((v) => {
      let actions = '';
      if (v.estado === 'buscando') {
        actions = `
          <div class="actions-row">
            <button class="btn btn-reject" data-action="reject" data-id="${v.id}">❌ Ocultar</button>
            <button class="btn btn-accept" data-action="accept" data-id="${v.id}" data-lat="${v.origen_lat}" data-lng="${v.origen_lng}">✅ ACEPTAR</button>
          </div>`;
      } else if (v.estado === 'aceptado') {
        actions = `
          <div style="background: rgba(255,107,0,.1); border: 1px dashed #FF6B00; padding: 15px; border-radius: 12px; margin-top: 10px;">
            <p style="font-size: 11px; margin-bottom: 8px; color: #FF6B00; font-weight: 800; text-transform: uppercase;">Introduce código del cliente:</p>
            <input type="number" id="otp-${v.id}" class="otp-input" placeholder="000" maxlength="3" style="width: 100%; padding: 12px; background: rgba(255,255,255,.05); border: 1px solid #FF6B00; border-radius: 10px; color: #fff; text-align: center; font-size: 20px; font-weight: 800; letter-spacing: 4px; margin-bottom: 10px; outline: none;">
            <button class="btn btn-accept" style="width:100%" data-action="verify" data-id="${v.id}">INICIAR VIAJE</button>
          </div>
          <button class="btn" style="width:100%; margin-top:10px; background:rgba(255,255,255,.05); font-size:12px;" data-action="navigate" data-lat="${v.origen_lat}" data-lng="${v.origen_lng}">🧭 Abrir Waze</button>`;
      } else if (v.estado === 'en_progreso') {
        actions = `
          <div style="text-align:center; padding: 10px 0;">
            <div style="color: #30D158; font-weight: 800; font-size: 14px; margin-bottom: 10px;">✨ VIAJE EN CURSO</div>
            <button class="btn btn-finish" style="background: #30D158; box-shadow: 0 4px 15px rgba(48,209,88,.3); width: 100%;" data-action="finish" data-id="${v.id}">🏁 FINALIZAR VIAJE</button>
            <button class="btn" style="width:100%; margin-top:10px; background:rgba(255,255,255,.05); font-size:12px;" data-action="navigate" data-lat="${v.destino_lat}" data-lng="${v.destino_lng}">🧭 Navegar a Destino</button>
          </div>`;
      }

      return `
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
      ${actions}
    </div>
  `;
    })
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

  container.querySelectorAll('[data-action="verify"]').forEach((btn) => {
    btn.addEventListener('click', () => handlers.onVerify(btn.dataset.id));
  });

  container.querySelectorAll('[data-action="finish"]').forEach((btn) => {
    btn.addEventListener('click', () => handlers.onFinish(btn.dataset.id));
  });

  container.querySelectorAll('[data-action="navigate"]').forEach((btn) => {
    btn.addEventListener('click', () =>
      window.open(`https://www.google.com/maps/dir/?api=1&destination=${btn.dataset.lat},${btn.dataset.lng}`, '_blank')
    );
  });
}
