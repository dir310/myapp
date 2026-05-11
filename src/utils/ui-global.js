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

/**
 * Notificación emergente rápida (Toast) que desaparece automáticamente.
 * @param {string} message - Mensaje a mostrar.
 * @param {string} type - 'success' (verde) o 'error' (rojo).
 */
export function zippyToast(message, type = 'success') {
  const toast = document.createElement('div');
  const color = type === 'error' ? '#FF3B30' : '#30D158';
  const icon = type === 'error' ? '🚫' : '⭐';

  toast.style.cssText = `
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%) translateY(-20px);
    background: rgba(20,20,22,0.95);
    border: 1px solid ${color};
    box-shadow: 0 8px 30px rgba(0,0,0,0.5), 0 0 15px ${color}40;
    color: #fff;
    padding: 14px 24px;
    border-radius: 30px;
    font-weight: 800;
    font-size: 14px;
    z-index: 999999;
    opacity: 0;
    transition: all 0.4s cubic-bezier(0.18, 0.89, 0.32, 1.28);
    pointer-events: none;
    display: flex;
    align-items: center;
    gap: 10px;
    white-space: nowrap;
  `;

  toast.innerHTML = `<span style="font-size: 18px;">${icon}</span> <span>${message}</span>`;
  document.body.appendChild(toast);

  // Animate In
  requestAnimationFrame(() => {
    setTimeout(() => {
      toast.style.transform = 'translateX(-50%) translateY(0)';
      toast.style.opacity = '1';
    }, 10);
  });

  // Animate Out & Remove
  setTimeout(() => {
    toast.style.transform = 'translateX(-50%) translateY(-20px)';
    toast.style.opacity = '0';
    setTimeout(() => {
      if (document.body.contains(toast)) document.body.removeChild(toast);
    }, 400);
  }, 2500);
}

/**
 * Modal de entrada de texto / valor.
 * @param {string} message      - Mensaje o instrucción.
 * @param {string} placeholder  - Texto de fondo del input.
 * @param {string} icon         - Emoji central.
 * @param {string} title        - Título.
 * @param {string} inputType    - Tipo de input (text, number, etc).
 * @returns {Promise<string|null>}
 */
export function zippyPrompt(message, placeholder = '', icon = '⌨️', title = '', inputType = 'text') {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'zippy-modal-backdrop';

    const titleHTML = title ? `<div class="zippy-modal-title">${title}</div>` : '';

    backdrop.innerHTML = `
      <div class="zippy-modal-container">
        <div class="zippy-modal-body">
          <span class="zippy-modal-icon">${icon}</span>
          ${titleHTML}
          <div class="zippy-modal-message" style="margin-bottom:15px;">${message}</div>
          <input type="${inputType}" id="zippyPromptInput" placeholder="${placeholder}" 
            style="width:100%; padding:14px; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); border-radius:12px; color:white; font-family:Inter,sans-serif; font-size:16px; margin-bottom:20px; outline:none; text-align:center; box-sizing:border-box;">
          <div class="zippy-modal-divider"></div>
          <div class="zippy-modal-actions">
            <button class="zippy-modal-btn zippy-modal-btn-primary" id="zippyPromptOk">
              <span>✅</span> Confirmar
            </button>
            <button class="zippy-modal-btn zippy-modal-btn-secondary" id="zippyPromptCancel">
              <span>↩️</span> Cancelar
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);
    const input = backdrop.querySelector('#zippyPromptInput');
    setTimeout(() => {
        backdrop.classList.add('show');
        input.focus();
    }, 10);

    const handle = (val) => {
      backdrop.classList.remove('show');
      setTimeout(() => { backdrop.remove(); resolve(val); }, 280);
    };

    backdrop.querySelector('#zippyPromptOk').onclick = () => handle(input.value);
    backdrop.querySelector('#zippyPromptCancel').onclick = () => handle(null);
    
    input.onkeydown = (e) => {
        if (e.key === 'Enter') handle(input.value);
        if (e.key === 'Escape') handle(null);
    };
  });
}
