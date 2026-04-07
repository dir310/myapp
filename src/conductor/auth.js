import { supabase } from '../config/supabase.js';
import { loadViajes, setupRealtimeChannel } from './realtime.js';

let currentUser = null;
let currentProfile = null;
let captchaAnswerRegister = 0;
let captchaAnswerLogin = 0;

// ── Configuración de seguridad ──
const SESSION_DURATION_MS = 12 * 60 * 60 * 1000; // 12 horas
const MAX_LOGIN_ATTEMPTS = 3;
const LOCK_DURATION_MS = 60 * 1000; // 60 segundos
const STORAGE_KEY = 'calmovil_driver_session'; // Formato: { id, timestamp }

// Elementos UI
const authModal = document.getElementById('authModal');
const mainAppContent = document.getElementById('mainAppContent');
const profileBtn = document.getElementById('profileBtn');
const profileSidebar = document.getElementById('profileSidebar');

export async function initAuth() {
  setupUIEvents();
  generateCaptcha();

  // Verificar sesión con timestamp — expira en 12 horas
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const { id, timestamp } = JSON.parse(raw);
      if (id && Date.now() - timestamp < SESSION_DURATION_MS) {
        handleSession({ user: { id } });
        return;
      } else {
        // Sesión expirada
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }
  handleSession(null);
}

// Lógica para mostrar/ocultar contraseña
window.togglePassword = function(inputId, iconElement) {
  const input = document.getElementById(inputId);
  if (input.type === 'password') {
    input.type = 'text';
    iconElement.style.filter = 'grayscale(0)'; // Color completo
    iconElement.style.opacity = '1';
  } else {
    input.type = 'password';
    iconElement.style.filter = 'grayscale(1)'; // Blanco y negro / tenue
    iconElement.style.opacity = '0.6';
  }
};

function setupUIEvents() {
  document.getElementById('showRegister').onclick = (e) => {
    e.preventDefault();
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('registerForm').style.display = 'block';
  };

  document.getElementById('showLogin').onclick = (e) => {
    e.preventDefault();
    document.getElementById('registerForm').style.display = 'none';
    document.getElementById('loginForm').style.display = 'block';
  };

  document.getElementById('loginBtn').onclick = handleLogin;
  document.getElementById('registerBtn').onclick = handleRegister;
  
  // Profile Sidebar toggles
  profileBtn.onclick = openProfile;
  document.getElementById('closeProfileBtn').onclick = () => profileSidebar.classList.remove('open');
  document.getElementById('logoutBtn').onclick = async () => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem('calmovil_driver_id'); // compatibilidad con sesión anterior
    window.location.reload();
  };

  // Edit Profile UI logic
  document.getElementById('editProfileBtn').onclick = () => {
    document.getElementById('editProfileForm').style.display = 'block';
    document.getElementById('editProfileBtn').style.display = 'none';
    if(currentProfile) {
      document.getElementById('editNombre').value = currentProfile.nombre || '';
      document.getElementById('editPlaca').value = currentProfile.placa || '';
      document.getElementById('editTelefono').value = currentProfile.telefono || '';
    }
  };

  document.getElementById('cancelEditBtn').onclick = () => {
    document.getElementById('editProfileForm').style.display = 'none';
    document.getElementById('editProfileBtn').style.display = 'inline-block';
  };

  document.getElementById('saveProfileBtn').onclick = async () => {
    const btn = document.getElementById('saveProfileBtn');
    const newNombre = document.getElementById('editNombre').value;
    const newPlaca = document.getElementById('editPlaca').value;
    const newTelefono = document.getElementById('editTelefono').value;

    if (!newNombre || !newPlaca || !newTelefono) return alert('Llena todos los campos');

    btn.textContent = '...';
    btn.disabled = true;

    const { error } = await supabase
      .from('conductores')
      .update({ nombre: newNombre, placa: newPlaca, telefono: newTelefono })
      .eq('id', currentUser.id);

    btn.textContent = 'Guardar';
    btn.disabled = false;

    if (error) {
      alert('Error updating: ' + error.message);
    } else {
      // Modificar localmente para reflejar el cambio inmediato
      currentProfile.nombre = newNombre;
      currentProfile.placa = newPlaca;
      currentProfile.telefono = newTelefono;
      
      // Esconder form y recargar visual
      document.getElementById('editProfileForm').style.display = 'none';
      document.getElementById('editProfileBtn').style.display = 'inline-block';
      openProfile(); // Re-render text fields
    }
  };
}

function generateCaptcha() {
  // Captcha para Registro
  const r1 = Math.floor(Math.random() * 9) + 1;
  const r2 = Math.floor(Math.random() * 9) + 1;
  captchaAnswerRegister = r1 + r2;
  const regQ = document.getElementById('captchaQuestion');
  if(regQ) regQ.textContent = `¿${r1} + ${r2}? =`;

  // Captcha para Login
  const l1 = Math.floor(Math.random() * 9) + 1;
  const l2 = Math.floor(Math.random() * 9) + 1;
  captchaAnswerLogin = l1 + l2;
  const loginQ = document.getElementById('loginCaptchaQuestion');
  if(loginQ) loginQ.textContent = `¿${l1} + ${l2}? =`;
}

async function handleSession(session) {
  if (session && session.user) {
    currentUser = session.user;
    
    // Cargar perfil completo
    const { data: profile } = await supabase
      .from('conductores')
      .select('*')
      .eq('id', currentUser.id)
      .single();
      
    currentProfile = profile;
    
    // Configurar UI para usuario logueado
    authModal.style.display = 'none';
    mainAppContent.style.display = 'block';
    profileBtn.style.display = 'block';
    
    // Iniciar carga de viajes y eventos realtime (solo cuando está logueado)
    loadViajes();
    setupRealtimeChannel();
  } else {
    currentUser = null;
    currentProfile = null;
    authModal.style.display = 'flex';
    mainAppContent.style.display = 'none';
    profileBtn.style.display = 'none';
  }
}

async function handleLogin() {
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const userCaptcha = parseInt(document.getElementById('loginCaptcha').value);
  const btn = document.getElementById('loginBtn');

  if (!email || !password) return alert('Por favor llena todos los campos.');
  
  if (isNaN(userCaptcha) || userCaptcha !== captchaAnswerLogin) {
    alert('La respuesta a la suma de seguridad es incorrecta.');
    generateCaptcha();
    return;
  }

  // ── Rate Limiting: verificar bloqueo ──
  const blockUntil = parseInt(sessionStorage.getItem('login_block_until') || '0');
  if (Date.now() < blockUntil) {
    const secsLeft = Math.ceil((blockUntil - Date.now()) / 1000);
    alert(`Demasiados intentos fallidos. Espera ${secsLeft} segundos antes de intentar de nuevo.`);
    return;
  }

  btn.textContent = 'Ingresando...';
  btn.disabled = true;

  // Custom Auth Login (Direct query)
  const { data, error } = await supabase
    .from('conductores')
    .select('*')
    .eq('email', email)
    .eq('password', password)
    .single();

  if (error || !data) {
    // Contar intento fallido
    let attempts = parseInt(sessionStorage.getItem('login_attempts') || '0') + 1;
    sessionStorage.setItem('login_attempts', attempts);

    if (attempts >= MAX_LOGIN_ATTEMPTS) {
      const until = Date.now() + LOCK_DURATION_MS;
      sessionStorage.setItem('login_block_until', until);
      sessionStorage.removeItem('login_attempts');
      
      // Mostrar cuenta regresiva en el botón
      let secsLeft = Math.ceil(LOCK_DURATION_MS / 1000);
      btn.textContent = `Bloqueado (${secsLeft}s)`;
      btn.disabled = true;
      const countdown = setInterval(() => {
        secsLeft--;
        if (secsLeft <= 0) {
          clearInterval(countdown);
          btn.textContent = 'Ingresar';
          btn.disabled = false;
        } else {
          btn.textContent = `Bloqueado (${secsLeft}s)`;
        }
      }, 1000);
      
      alert(`Demasiados intentos. Serás desbloqueado en ${Math.ceil(LOCK_DURATION_MS/1000)} segundos.`);
    } else {
      alert(`Correo o clave incorrectos. Intento ${attempts}/${MAX_LOGIN_ATTEMPTS}.`);
      btn.textContent = 'Ingresar';
      btn.disabled = false;
    }
    generateCaptcha();
    return;
  }

  // Login exitoso — limpiar contadores y guardar sesión con timestamp
  sessionStorage.removeItem('login_attempts');
  sessionStorage.removeItem('login_block_until');
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ id: data.id, timestamp: Date.now() }));
  window.location.reload();
}

async function handleRegister() {
  const nombre = document.getElementById('regNombre').value;
  const email = document.getElementById('regEmail').value;
  const password = document.getElementById('regPassword').value;
  const telefono = document.getElementById('regTelefono').value;
  const placa = document.getElementById('regPlaca').value;
  const userCaptcha = parseInt(document.getElementById('regCaptcha').value);
  const terms = document.getElementById('regTerms').checked;
  const btn = document.getElementById('registerBtn');

  if (!nombre || !email || !password || !telefono || !placa) {
    return alert('Por favor llena todos los campos.');
  }

  if (!terms) {
    return alert('Debes marcar la casilla aceptando los términos de responsabilidad para poder registrarte.');
  }

  if (userCaptcha !== captchaAnswerRegister) {
    generateCaptcha();
    return alert('La respuesta matemática es incorrecta.');
  }

  btn.textContent = 'Creando cuenta...';
  btn.disabled = true;

  // Custom Auth Register (Direct Insert bypassing Supabase Auth)
  const userId = crypto.randomUUID();

  const { error: dbError } = await supabase
    .from('conductores')
    .insert([{
      id: userId,
      nombre,
      email,
      password,
      telefono,
      placa
    }]);

  if (dbError) {
    if (dbError.message.includes('duplicate key') || dbError.message.includes('unique')) {
      alert('Error en registro: Ya existe una cuenta con este correo.');
    } else {
      alert('Error creando el perfil: ' + dbError.message);
    }
    return resetRegisterBtn(btn);
  }

  // Guardar en sesión local con timestamp y recargar
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ id: userId, timestamp: Date.now() }));
  btn.textContent = '¡Éxito! Entrando...';
  window.location.reload();
}

function resetRegisterBtn(btn) {
  btn.textContent = 'Crear Cuenta';
  btn.disabled = false;
  generateCaptcha();
}

export function getCurrentProfile() {
  return currentProfile;
}

// Lógica de visualización del Perfil
async function openProfile() {
  profileSidebar.classList.add('open');
  
  if (currentProfile) {
    document.getElementById('profileName').textContent = currentProfile.nombre;
    document.getElementById('profilePlaca').textContent = `Placa: ${currentProfile.placa}`;
    document.getElementById('profileTelefono').textContent = `Cel: ${currentProfile.telefono}`;
    
    if (currentProfile.foto_url) {
      const imgEl = document.getElementById('profilePic');
      imgEl.src = currentProfile.foto_url;
      imgEl.style.display = 'block';
      document.getElementById('profilePicAvatar').style.display = 'none';
    }
    
    // Cargar estadísticas
    const { data: viajesTerminados, error } = await supabase
      .from('viajes')
      .select('tarifa, destino_nombre, origen_nombre')
      .eq('conductor_id', currentProfile.id)
      .eq('estado', 'finalizado')
      .order('created_at', { ascending: false });
      
    if (!error && viajesTerminados) {
      document.getElementById('statTrips').textContent = viajesTerminados.length;
      
      const ganancias = viajesTerminados.reduce((acc, current) => acc + (current.tarifa || 0), 0);
      document.getElementById('statEarnings').textContent = `$${ganancias.toLocaleString('es-CO')}`;
      
      const historyList = document.getElementById('historyList');
      if (viajesTerminados.length === 0) {
        historyList.innerHTML = '<p style="color:rgba(255,255,255,.4); font-size:12px; text-align:center;">No hay viajes finalizados aún.</p>';
      } else {
        const historyHTML = viajesTerminados.slice(0, 5).map(v => `
          <div style="background:rgba(255,255,255,.05); border-radius:8px; padding:10px; font-size:12px;">
            <div style="color:#30D158; font-weight:bold; margin-bottom:4px;">$${v.tarifa.toLocaleString('es-CO')}</div>
            <div style="color:rgba(255,255,255,.8);">${v.origen_nombre} ➔ ${v.destino_nombre}</div>
          </div>
        `).join('');
        historyList.innerHTML = historyHTML;
      }
    }
  }
}
