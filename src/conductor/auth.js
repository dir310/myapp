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

  // Escuchar cambios de sesión y verificar sesión inicial
  const { data: { session } } = await supabase.auth.getSession();
  handleSession(session);

  supabase.auth.onAuthStateChange((_event, session) => {
    handleSession(session);
  });
}

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
    await supabase.auth.signOut();
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

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    alert('Error al iniciar sesión: ' + error.message);
    btn.textContent = 'Ingresar';
    btn.disabled = false;
  }
  // Si no hay error, el onAuthStateChange maneja el resto
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

  // 1. Sign up en Supabase Auth
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password
  });

  if (authError) {
    alert('Error en registro: ' + authError.message);
    return resetRegisterBtn(btn);
  }

  const userId = authData.user.id;

  // 2. Crear perfil en tabla `conductores`
  btn.textContent = 'Guardando perfil...';
  const { error: dbError } = await supabase
    .from('conductores')
    .insert([{
      id: userId,
      nombre,
      telefono,
      placa
    }]);

  if (dbError) {
    alert('Error creando el perfil: ' + dbError.message);
    return resetRegisterBtn(btn);
  }

  // Listo, el onAuthStateChange se activa y la UI cambia
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
