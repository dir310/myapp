import { supabase } from '../config/supabase.js';
import { loadViajes, setupRealtimeChannel } from './realtime.js';

let currentUser = null;
let currentProfile = null;
let captchaAnswer = 0;

// Elementos UI
const authModal = document.getElementById('authModal');
const mainAppContent = document.getElementById('mainAppContent');
const profileBtn = document.getElementById('profileBtn');
const profileSidebar = document.getElementById('profileSidebar');

export async function initAuth() {
  setupUIEvents();
  generateCaptcha();

  // Custom Auth: Verificar sesión en LocalStorage
  const driverId = localStorage.getItem('calmovil_driver_id');
  
  if (driverId) {
    // Simular que tenemos una sesión buscando directamente al conductor
    handleSession({ user: { id: driverId } });
  } else {
    handleSession(null);
  }
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
    localStorage.removeItem('calmovil_driver_id');
    window.location.reload();
  };
}

function generateCaptcha() {
  const n1 = Math.floor(Math.random() * 9) + 1;
  const n2 = Math.floor(Math.random() * 9) + 1;
  captchaAnswer = n1 + n2;
  document.getElementById('captchaQuestion').textContent = `¿${n1} + ${n2}? =`;
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
  const email = document.getElementById('loginEmail').value;
  const password = document.getElementById('loginPassword').value;
  const btn = document.getElementById('loginBtn');

  if (!email || !password) return alert('Por favor llena todos los campos.');

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
    alert('Error al iniciar sesión: Correo o clave incorrectos.');
    btn.textContent = 'Ingresar';
    btn.disabled = false;
    return;
  }

  // Login successful
  localStorage.setItem('calmovil_driver_id', data.id);
  window.location.reload();
}

async function handleRegister() {
  const nombre = document.getElementById('regNombre').value;
  const email = document.getElementById('regEmail').value;
  const password = document.getElementById('regPassword').value;
  const telefono = document.getElementById('regTelefono').value;
  const placa = document.getElementById('regPlaca').value;
  const userCaptcha = parseInt(document.getElementById('regCaptcha').value);
  const btn = document.getElementById('registerBtn');

  if (!nombre || !email || !password || !telefono || !placa) {
    return alert('Por favor llena todos los campos.');
  }

  if (userCaptcha !== captchaAnswer) {
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

  // Guardar en sesión local y recargar
  localStorage.setItem('calmovil_driver_id', userId);
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
