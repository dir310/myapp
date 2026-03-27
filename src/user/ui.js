/**
 * User page UI management: bottom sheet, mode toggle, status bar.
 */

let sheetMinimized = false;

/**
 * Toggle bottom sheet minimize/expand state.
 */
export function toggleSheet() {
  const sheet = document.getElementById('bottomSheet');
  sheetMinimized = !sheetMinimized;

  if (sheetMinimized) {
    sheet.classList.add('minimized');
    document.querySelector('.leaflet-control-zoom').style.marginBottom = '60px';
  } else {
    sheet.classList.remove('minimized');
    document.querySelector('.leaflet-control-zoom').style.marginBottom = '270px';
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

  document.getElementById('modeSearchBtn').classList.toggle('active', m === 'search');
  document.getElementById('modeClickBtn').classList.toggle('active', m === 'click');

  const hint = document.getElementById('clickHint');

  if (m === 'click') {
    document.querySelectorAll('.route-input').forEach((i) => (i.style.display = 'none'));
    document.querySelector('.route-dots').style.display = 'none';
    hint.style.display = 'block';
    state.nextClick = state.startLatLng ? 'end' : 'start';
    map.getContainer().style.cursor = 'crosshair';
    if (sheetMinimized) toggleSheet();
  } else {
    document.querySelectorAll('.route-input').forEach((i) => (i.style.display = ''));
    document.querySelector('.route-dots').style.display = '';
    hint.style.display = 'none';
    map.getContainer().style.cursor = '';
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
