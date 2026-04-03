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
  const currentConductor = document.getElementById('conductorName').value || 'Un Conductor';

  // Privacidad: Solo ves solicitudes ("buscando") y TUS propios viajes ya aceptados.
  const filteredViajes = viajes.filter((v) => {
    if (v.estado === 'buscando') return true;
    return v.conductor_id === currentConductor;
  });

  if (filteredViajes.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div style="font-size: 45px; margin-bottom: 15px; opacity:.3;">⏱️</div>
        Buscando pasajeros<br>cerca de La Calera...
      </div>`;
    return;
  }

  container.innerHTML = filteredViajes
    .map((v) => {
      let actions = '';
      if (v.estado === 'buscando') {
        actions = `
          <div class="actions-row">
            <button class="btn btn-reject" data-action="reject" data-id="${v.id}">❌ RECHAZAR</button>
            <button class="btn btn-accept" data-action="accept" data-id="${v.id}" data-lat="${v.origen_lat}" data-lng="${v.origen_lng}">✅ ACEPTAR</button>
          </div>`;
      } else if (v.estado === 'aceptado') {
        actions = `
          <div style="background: rgba(48,209,88,.1); border: 1.5px dashed #30D158; padding: 15px; border-radius: 12px; margin-top: 10px; text-align: center;">
            <p style="font-size: 11px; margin-bottom: 8px; color: #30D158; font-weight: 800; text-transform: uppercase;">¡Pasajero encontrado!</p>
            <button class="btn" style="width:100%; margin-bottom:10px; background:rgba(255,255,255,.1); font-size:12px; color:#30D158; border:1px solid #30D158;" data-action="navigate" data-lat="${v.origen_lat}" data-lng="${v.origen_lng}">🧭 Navegar a Recoger</button>
            <button class="btn btn-accept" style="width:100%; background: #30D158;" data-action="verify" data-id="${v.id}">INICIAR VIAJE</button>
            <button class="btn btn-reject" style="width:100%; margin-top:10px; opacity:0.6;" data-action="cancel_active" data-id="${v.id}">Cancelar Servicio</button>
          </div>`;
      } else if (v.estado === 'en_progreso') {
        actions = `
          <div style="text-align:center; padding: 10px 0;">
            <div style="color: #30D158; font-weight: 800; font-size: 14px; margin-bottom: 10px;">✨ VIAJE EN CURSO</div>
            <button class="btn" style="width:100%; margin-bottom:10px; background:rgba(255,255,255,.1); font-size:12px; color:#30D158; border:1px solid #30D158;" data-action="navigate" data-lat="${v.destino_lat}" data-lng="${v.destino_lng}">🧭 Navegar a Destino</button>
            <button class="btn btn-finish" style="background: #30D158; box-shadow: 0 4px 15px rgba(48,209,88,.3); width: 100%;" data-action="finish" data-id="${v.id}">🏁 FINALIZAR VIAJE</button>
            <button class="btn btn-reject" style="width:100%; margin-top:10px; opacity:0.6;" data-action="cancel_active" data-id="${v.id}">Cancelar Servicio</button>
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

  container.querySelectorAll('[data-action="cancel_active"]').forEach((btn) => {
    btn.addEventListener('click', () => handlers.onCancelActive(btn.dataset.id));
  });

    container.querySelectorAll('[data-action="navigate"]').forEach((btn) => {
    btn.addEventListener('click', () =>
      window.open(`https://waze.com/ul?ll=${btn.dataset.lat},${btn.dataset.lng}&navigate=yes`, '_blank')
    );
  });
}

/**
 * Show a large notification banner for cancellations or ratings.
 * @param {string} msg - Message to display.
 * @param {string} type - 'error' or 'success'.
 */
export function showNotification(msg, type = 'success') {
  const banner = document.createElement('div');
  const color = type === 'error' ? '#FF3B30' : '#30D158';
  const icon = type === 'error' ? '🚫' : '🌟';
  
  banner.style.cssText = `
    position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
    width: 90%; max-width: 400px; padding: 16px; border-radius: 16px;
    background: rgba(20,20,20,0.95); border: 2px solid ${color};
    box-shadow: 0 10px 40px rgba(0,0,0,0.8); z-index: 10000;
    display: flex; align-items: center; gap: 15px; color: #fff;
    animation: slideInDown 0.5s cubic-bezier(0.18, 0.89, 0.32, 1.28);
  `;
  
  banner.innerHTML = `
    <div style="font-size: 30px;">${icon}</div>
    <div style="flex:1;">
      <div style="font-size: 11px; color: ${color}; font-weight: 800; text-transform: uppercase; margin-bottom: 2px;">Notificación</div>
      <div style="font-size: 15px; font-weight: 600;">${msg}</div>
    </div>
  `;
  
  document.body.appendChild(banner);
  playAlert();

  setTimeout(() => {
    banner.style.opacity = '0';
    banner.style.transform = 'translateX(-50%) translateY(-20px)';
    banner.style.transition = 'all 0.5s ease-in';
    setTimeout(() => banner.remove(), 500);
  }, 5000);
}
