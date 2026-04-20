/**
 * ZIPPY Premium UI Utilities — Global Modals
 * Modales personalizados con glassmorphism, animaciones y botones premium.
 * Reemplaza completamente alert() y confirm() nativos del navegador.
 */

/**
 * Modal de información / aviso.
 * @param {string} message  - Mensaje a mostrar.
 * @param {string} icon     - Emoji grande central (default 🔔).
 * @param {string} title    - Título opcional (default vacío).
 * @param {object} btn      - { label, emoji } para el botón de confirmar.
 */
export function zippyAlert(message, icon = '🔔', title = '', btn = {}) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'zippy-modal-backdrop';

    const titleHTML  = title  ? `<div class="zippy-modal-title">${title}</div>`  : '';
    const btnLabel   = btn.label ?? 'Entendido';
    const btnEmoji   = btn.emoji ?? '✅';

    backdrop.innerHTML = `
      <div class="zippy-modal-container">
        <div class="zippy-modal-body">
          <span class="zippy-modal-icon">${icon}</span>
          ${titleHTML}
          <div class="zippy-modal-message">${message}</div>
          <div class="zippy-modal-divider"></div>
          <div class="zippy-modal-actions">
            <button class="zippy-modal-btn zippy-modal-btn-primary" id="zippyAlertOk">
              <span>${btnEmoji}</span> ${btnLabel}
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);
    setTimeout(() => backdrop.classList.add('show'), 10);

    const close = () => {
      backdrop.classList.remove('show');
      setTimeout(() => { backdrop.remove(); resolve(); }, 280);
    };

    backdrop.querySelector('#zippyAlertOk').onclick = close;
  });
}

/**
 * Modal de confirmación con dos botones.
 * @param {string} message   - Mensaje a mostrar.
 * @param {string} icon      - Emoji grande central (default ❓).
 * @param {string} title     - Título opcional.
 * @param {object} btnOk     - { label, emoji } botón afirmativo.
 * @param {object} btnCancel - { label, emoji } botón cancelar.
 * @returns {Promise<boolean>}
 */
export function zippyConfirm(message, icon = '❓', title = '', btnOk = {}, btnCancel = {}) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'zippy-modal-backdrop';

    const titleHTML      = title ? `<div class="zippy-modal-title">${title}</div>` : '';
    const okLabel        = btnOk.label    ?? 'Confirmar';
    const okEmoji        = btnOk.emoji    ?? '✅';
    const cancelLabel    = btnCancel.label ?? 'Cancelar';
    const cancelEmoji    = btnCancel.emoji ?? '↩️';

    backdrop.innerHTML = `
      <div class="zippy-modal-container">
        <div class="zippy-modal-body">
          <span class="zippy-modal-icon">${icon}</span>
          ${titleHTML}
          <div class="zippy-modal-message">${message}</div>
          <div class="zippy-modal-divider"></div>
          <div class="zippy-modal-actions">
            <button class="zippy-modal-btn zippy-modal-btn-primary" id="zippyConfirmYes">
              <span>${okEmoji}</span> ${okLabel}
            </button>
            <button class="zippy-modal-btn zippy-modal-btn-secondary" id="zippyConfirmNo">
              <span>${cancelEmoji}</span> ${cancelLabel}
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);
    setTimeout(() => backdrop.classList.add('show'), 10);

    const handle = (result) => {
      backdrop.classList.remove('show');
      setTimeout(() => { backdrop.remove(); resolve(result); }, 280);
    };

    backdrop.querySelector('#zippyConfirmYes').onclick = () => handle(true);
    backdrop.querySelector('#zippyConfirmNo').onclick  = () => handle(false);
  });
}

/**
 * Modal de acción peligrosa/destructiva — botón principal en rojo.
 * @param {string} message   - Mensaje de advertencia.
 * @param {string} icon      - Emoji (default ⚠️).
 * @param {string} title     - Título.
 * @param {object} btnOk     - { label, emoji } botón de acción destructiva.
 * @param {object} btnCancel - { label, emoji } botón cancelar.
 * @returns {Promise<boolean>}
 */
export function zippyDanger(message, icon = '⚠️', title = '¿Estás seguro?', btnOk = {}, btnCancel = {}) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'zippy-modal-backdrop';

    const okLabel     = btnOk.label    ?? 'Sí, continuar';
    const okEmoji     = btnOk.emoji    ?? '🗑️';
    const cancelLabel = btnCancel.label ?? 'No, volver';
    const cancelEmoji = btnCancel.emoji ?? '↩️';

    backdrop.innerHTML = `
      <div class="zippy-modal-container">
        <div class="zippy-modal-body">
          <span class="zippy-modal-icon">${icon}</span>
          <div class="zippy-modal-title" style="color:#FF453A;">${title}</div>
          <div class="zippy-modal-message">${message}</div>
          <div class="zippy-modal-divider"></div>
          <div class="zippy-modal-actions">
            <button class="zippy-modal-btn zippy-modal-btn-danger" id="zippyDangerYes">
              <span>${okEmoji}</span> ${okLabel}
            </button>
            <button class="zippy-modal-btn zippy-modal-btn-secondary" id="zippyDangerNo">
              <span>${cancelEmoji}</span> ${cancelLabel}
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);
    setTimeout(() => backdrop.classList.add('show'), 10);

    const handle = (result) => {
      backdrop.classList.remove('show');
      setTimeout(() => { backdrop.remove(); resolve(result); }, 280);
    };

    backdrop.querySelector('#zippyDangerYes').onclick = () => handle(true);
    backdrop.querySelector('#zippyDangerNo').onclick  = () => handle(false);
  });
}
