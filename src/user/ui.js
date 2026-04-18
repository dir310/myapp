/**
 * User page UI management: bottom sheet, mode toggle, status bar.
 */

let sheetMinimized = false;

/**
 * Toggle sidebar minimize/expand state.
 */
export function toggleSheet() {
  const sheet = document.getElementById('sidebar');
  sheetMinimized = !sheetMinimized;

  if (sheetMinimized) {
    sheet.classList.add('minimized');
    document.querySelector('.leaflet-control-zoom').style.marginLeft = '70px';
  } else {
    sheet.classList.remove('minimized');
    document.querySelector('.leaflet-control-zoom').style.marginLeft = '360px';
  }
}

/**
 * Returns whether the sheet is currently minimized.
 */
export function isSheetMinimized() {
  return sheetMinimized;
}

/**
 * Set input mode: 'search' (text input) or 'click' (map click).
 * @param {string} m - Mode string.
 * @param {object} state - App state with startLatLng reference.
 * @param {L.Map} map - Leaflet map instance.
 */
export function setMode(m, state, map) {
  state.mode = m;
  const hint = document.getElementById('clickHint');
  const banner = document.getElementById('guidanceBanner');
  const gpsBtn = document.getElementById('gpsQuickBtn');

  if (m === 'click') {
    hint.style.display = 'block';
    state.nextClick = state.startLatLng ? 'end' : 'start';
    map.getContainer().style.cursor = 'crosshair';
    if (sheetMinimized) toggleSheet();
    
    // Asistente Guiado
    if (banner) {
      banner.style.display = 'flex';
      updateGuidance(state.nextClick === 'start' ? 1 : 2);
    }
    if (gpsBtn && state.nextClick === 'start') gpsBtn.style.display = 'flex';
  } else {
    hint.style.display = 'none';
    map.getContainer().style.cursor = '';
    if (banner) banner.style.display = 'none';
    if (gpsBtn) gpsBtn.style.display = 'none';
  }
}

/**
 * Update the guidance banner text and icon based on current step.
 * @param {number} step - 1 (Start), 2 (End), 3 (Done)
 */
export function updateGuidance(step) {
  const textEl = document.getElementById('guidanceText');
  const iconEl = document.getElementById('guidanceIcon');
  const gpsBtn = document.getElementById('gpsQuickBtn');

  if (!textEl || !iconEl) return;

  if (step === 1) {
    iconEl.textContent = '📍';
    textEl.textContent = 'Selecciona el Inicio. Toca el mapa o usa el botón 🎯';
    if (gpsBtn) gpsBtn.style.display = 'flex';
  } else if (step === 2) {
    iconEl.textContent = '🏁';
    textEl.textContent = '¡Excelente! Ahora toca en el mapa tu Destino.';
    if (gpsBtn) gpsBtn.style.display = 'none';
  } else if (step === 3) {
    iconEl.textContent = '🏍️';
    textEl.textContent = '¡Ruta lista! Revisa tu tarifa y pide tu moto.';
    if (gpsBtn) gpsBtn.style.display = 'none';
  }
}

/**
 * Show or hide the status bar with a message.
 * @param {string} msg - Status message (empty to hide).
 * @param {boolean} isError - Style as error.
 */
export function showStatus(msg, isError) {
  const el = document.getElementById('statusBar');
  if (!msg) {
    el.style.display = 'none';
    return;
  }
  el.textContent = msg;
  el.className = 'status-bar' + (isError ? ' error' : '');
  el.style.display = 'block';
}

/**
 * Hide the guidance banner and GPS button immediately.
 */
export function hideGuidance() {
  const banner = document.getElementById('guidanceBanner');
  const gpsBtn = document.getElementById('gpsQuickBtn');
  if (banner) banner.style.display = 'none';
  if (gpsBtn) gpsBtn.style.display = 'none';
}
/**
 * Initialize swipe gestures to open (right) and close (left) the sidebar.
 */
export function initSwipeGestures() {
  let touchStartX = 0;
  let touchStartY = 0;
  const threshold = 60; // Pixeles mínimos para detectar el swipe
  const sidebar = document.getElementById('sidebar');

  // Abrir: Deslizar desde el borde izquierdo hacia la derecha
  window.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });

  window.addEventListener('touchend', (e) => {
    const touchEndX = e.changedTouches[0].clientX;
    const touchEndY = e.changedTouches[0].clientY;
    const diffX = touchEndX - touchStartX;
    const diffY = Math.abs(touchEndY - touchStartY);

    // Solo si el deslizamiento es mayoritariamente horizontal y desde el borde
    if (sheetMinimized && touchStartX < 50 && diffX > threshold && diffY < 100) {
      toggleSheet();
    }
  }, { passive: true });

  // Cerrar: Deslizar la barra lateral hacia la izquierda
  sidebar.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
  }, { passive: true });

  sidebar.addEventListener('touchend', (e) => {
    const touchEndX = e.changedTouches[0].clientX;
    const diffX = touchStartX - touchEndX;

    if (!sheetMinimized && diffX > threshold) {
      toggleSheet();
    }
  }, { passive: true });
}
