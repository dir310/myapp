/**
 * ZIPPY Premium UI Utilities - Global Modals
 * Reemplaza alert() y confirm() nativos con diseño personalizado.
 */

export function zippyAlert(message, icon = '🔔') {
    return new Promise((resolve) => {
        const backdrop = document.createElement('div');
        backdrop.className = 'zippy-modal-backdrop';
        
        backdrop.innerHTML = `
            <div class="zippy-modal-container">
                <div class="zippy-modal-icon">${icon}</div>
                <div class="zippy-modal-message">${message}</div>
                <div class="zippy-modal-actions">
                    <button class="zippy-modal-btn zippy-modal-btn-primary" id="zippyAlertOk">
                        ✅ Aceptar
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(backdrop);
        
        // Trigger animation
        setTimeout(() => backdrop.classList.add('show'), 10);

        const close = () => {
            backdrop.classList.remove('show');
            setTimeout(() => {
                backdrop.remove();
                resolve();
            }, 300);
        };

        document.getElementById('zippyAlertOk').onclick = close;
    });
}

export function zippyConfirm(message, icon = '❓') {
    return new Promise((resolve) => {
        const backdrop = document.createElement('div');
        backdrop.className = 'zippy-modal-backdrop';
        
        backdrop.innerHTML = `
            <div class="zippy-modal-container">
                <div class="zippy-modal-icon">${icon}</div>
                <div class="zippy-modal-message">${message}</div>
                <div class="zippy-modal-actions">
                    <button class="zippy-modal-btn zippy-modal-btn-primary" id="zippyConfirmYes">
                        ✅ Aceptar
                    </button>
                    <button class="zippy-modal-btn zippy-modal-btn-secondary" id="zippyConfirmNo">
                        ❌ Cancelar
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(backdrop);
        
        // Trigger animation
        setTimeout(() => backdrop.classList.add('show'), 10);

        const handle = (result) => {
            backdrop.classList.remove('show');
            setTimeout(() => {
                backdrop.remove();
                resolve(result);
            }, 300);
        };

        document.getElementById('zippyConfirmYes').onclick = () => handle(true);
        document.getElementById('zippyConfirmNo').onclick = () => handle(false);
    });
}
