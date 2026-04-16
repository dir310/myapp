/**
 * auth-admin.js — Autenticación del Panel Administrativo
 * 
 * Protege el panel de clientes con un PIN cifrado con SHA-256.
 * La sesión se guarda en sessionStorage (se borra al cerrar el navegador).
 * 
 * PIN por defecto: MovilCal2025
 * Para cambiarlo, usa: console.log(await hashPin('TuNuevoPIN')) y reemplaza HASHED_PIN.
 */

// SHA-256 del PIN "MovilCal2025"
// Para cambiarlo ejecuta en Node.js:
//   node -e "const c=require('crypto'); console.log(c.createHash('sha256').update('TuNuevoPIN').digest('hex'))"
// Luego pega el resultado en HASHED_PIN.
const HASHED_PIN = '84bfe128940c7cb195bcc3bab05b4cd7bdd5527a92e9c5eefa462a48d11e4d52';

const SESSION_KEY = 'calmovil_admin_auth';
const SESSION_DURATION_MS = 4 * 60 * 60 * 1000; // 4 horas

/**
 * Genera el hash SHA-256 de un string.
 * @param {string} text
 * @returns {Promise<string>} hex string del hash
 */
async function hashPin(text) {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Verifica si hay una sesión admin válida en sessionStorage.
 * @returns {boolean}
 */
export function isAdminAuthenticated() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return false;
    const { timestamp } = JSON.parse(raw);
    if (Date.now() - timestamp > SESSION_DURATION_MS) {
      sessionStorage.removeItem(SESSION_KEY);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Intenta autenticar con el PIN dado.
 * @param {string} pin - PIN ingresado por el usuario
 * @returns {Promise<boolean>} true si el PIN es correcto
 */
export async function authenticateAdmin(pin) {
  const inputHash = await hashPin(pin);
  if (inputHash === HASHED_PIN) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ timestamp: Date.now() }));
    return true;
  }
  return false;
}

/**
 * Cierra la sesión del admin.
 */
export function logoutAdmin() {
  sessionStorage.removeItem(SESSION_KEY);
  location.reload();
}

/**
 * Muestra el overlay de PIN y resuelve cuando el usuario se autentica.
 * @returns {Promise<void>}
 */
export function showAdminPinOverlay() {
  return new Promise((resolve) => {
    // Crear overlay
    const overlay = document.createElement('div');
    overlay.id = 'adminPinOverlay';
    overlay.innerHTML = `
      <style>
        #adminPinOverlay {
          position: fixed; inset: 0; z-index: 99999;
          background: #0d0d0d;
          display: flex; align-items: center; justify-content: center;
          font-family: 'Inter', sans-serif;
        }
        #adminPinCard {
          background: #1a1a1a;
          border: 1px solid rgba(255,107,0,0.2);
          border-radius: 20px;
          padding: 40px 35px;
          width: 320px;
          box-shadow: 0 25px 60px rgba(0,0,0,0.6);
          text-align: center;
        }
        #adminPinCard h2 { color: #FF6B00; margin: 0 0 6px; font-size: 22px; font-weight: 800; }
        #adminPinCard p { color: rgba(255,255,255,0.5); font-size: 13px; margin: 0 0 28px; line-height: 1.5; }
        #pinInput {
          width: 100%; box-sizing: border-box;
          background: rgba(255,255,255,0.06);
          border: 1.5px solid rgba(255,255,255,0.12);
          border-radius: 10px; padding: 14px 16px;
          color: #fff; font-size: 18px; letter-spacing: 4px;
          text-align: center; outline: none;
          font-family: 'Inter', sans-serif;
          margin-bottom: 16px;
          transition: border-color 0.2s;
        }
        #pinInput:focus { border-color: #FF6B00; }
        #pinInput.error { border-color: #ff3b3b; animation: shake 0.3s ease; }
        @keyframes shake {
          0%,100%{ transform: translateX(0); }
          25%{ transform: translateX(-8px); }
          75%{ transform: translateX(8px); }
        }
        #pinSubmitBtn {
          width: 100%; padding: 14px;
          background: linear-gradient(135deg, #FF6B00, #FF8C00);
          border: none; border-radius: 10px;
          color: #fff; font-size: 15px; font-weight: 800;
          cursor: pointer; letter-spacing: 0.5px;
          transition: opacity 0.2s, transform 0.1s;
        }
        #pinSubmitBtn:hover { opacity: 0.9; transform: translateY(-1px); }
        #pinSubmitBtn:active { transform: translateY(0); }
        #pinSubmitBtn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
        #pinError { color: #ff4545; font-size: 12px; margin-top: 12px; min-height: 18px; font-weight: 600; }
        #pinAttemptsWarn { color: rgba(255,255,255,0.3); font-size: 11px; margin-top: 8px; }
      </style>
      <div id="adminPinCard">
        <div style="font-size:48px; margin-bottom:12px;">🔐</div>
        <h2>Acceso Restringido</h2>
        <p>Este panel es solo para administradores de ZIPPY. Ingresa tu PIN de acceso.</p>
        <input type="password" id="pinInput" placeholder="••••••" maxlength="20" autocomplete="off">
        <button id="pinSubmitBtn">Ingresar al Panel</button>
        <div id="pinError"></div>
        <div id="pinAttemptsWarn"></div>
      </div>
    `;
    document.body.appendChild(overlay);

    const input = document.getElementById('pinInput');
    const btn = document.getElementById('pinSubmitBtn');
    const errorEl = document.getElementById('pinError');
    const attemptsEl = document.getElementById('pinAttemptsWarn');

    // Rate limiting local para el PIN
    let attempts = parseInt(sessionStorage.getItem('admin_pin_attempts') || '0');
    let blockUntil = parseInt(sessionStorage.getItem('admin_pin_block_until') || '0');

    function checkBlocked() {
      if (Date.now() < blockUntil) {
        const remaining = Math.ceil((blockUntil - Date.now()) / 1000);
        btn.disabled = true;
        input.disabled = true;
        errorEl.textContent = `Demasiados intentos. Espera ${remaining}s`;
        return true;
      }
      return false;
    }

    if (checkBlocked()) {
      const countdown = setInterval(() => {
        if (!checkBlocked()) {
          clearInterval(countdown);
          btn.disabled = false;
          input.disabled = false;
          errorEl.textContent = '';
          attempts = 0;
          sessionStorage.removeItem('admin_pin_attempts');
          sessionStorage.removeItem('admin_pin_block_until');
        }
      }, 1000);
    }

    async function tryPin() {
      if (checkBlocked()) return;

      const pin = input.value.trim();
      if (!pin) { errorEl.textContent = 'Ingresa el PIN.'; return; }

      btn.disabled = true;
      btn.textContent = 'Verificando...';

      const ok = await authenticateAdmin(pin);

      if (ok) {
        overlay.style.transition = 'opacity 0.3s';
        overlay.style.opacity = '0';
        setTimeout(() => { overlay.remove(); resolve(); }, 300);
      } else {
        attempts++;
        sessionStorage.setItem('admin_pin_attempts', attempts);
        input.value = '';
        input.classList.add('error');
        setTimeout(() => input.classList.remove('error'), 400);

        if (attempts >= 3) {
          const until = Date.now() + 60000;
          sessionStorage.setItem('admin_pin_block_until', until);
          blockUntil = until;
          checkBlocked();
          const countdown = setInterval(() => {
            if (!checkBlocked()) {
              clearInterval(countdown);
              btn.disabled = false;
              input.disabled = false;
              errorEl.textContent = '';
              attempts = 0;
              sessionStorage.removeItem('admin_pin_attempts');
              sessionStorage.removeItem('admin_pin_block_until');
            }
          }, 1000);
        } else {
          errorEl.textContent = 'PIN incorrecto.';
          attemptsEl.textContent = `Intentos fallidos: ${attempts}/3`;
          btn.disabled = false;
          btn.textContent = 'Ingresar al Panel';
        }
      }
    }

    btn.addEventListener('click', tryPin);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') tryPin(); });
    input.focus();
  });
}
