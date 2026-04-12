import { supabase } from '../config/supabase.js';
import { loadViajes, setupRealtimeChannel } from './realtime.js';
import { initRadar } from './ui.js';

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
window.togglePassword = function (inputId, iconElement) {
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
  document.getElementById('loginBtn').onclick = handleLogin;
  document.getElementById('saveCompleteProfileBtn').onclick = handleSaveProfileSetup;

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
    if (currentProfile) {
      document.getElementById('editNombre').value = currentProfile.nombre || '';
      document.getElementById('editPlaca').value = currentProfile.placa || '';
      document.getElementById('editMarca').value = currentProfile.marca || '';
      document.getElementById('editColor').value = currentProfile.color || '';
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
    const newMarca = document.getElementById('editMarca').value;
    const newColor = document.getElementById('editColor').value;
    const newTelefono = document.getElementById('editTelefono').value;

    if (!newNombre || !newPlaca || !newTelefono || !newMarca || !newColor) return alert('Llena todos los campos');

    btn.textContent = '...';
    btn.disabled = true;

    const { error } = await supabase
      .from('conductores')
      .update({ nombre: newNombre, placa: newPlaca, telefono: newTelefono, marca: newMarca, color: newColor })
      .eq('id', currentUser.id);

    btn.textContent = 'Guardar';
    btn.disabled = false;

    if (error) {
      alert('Error updating: ' + error.message);
    } else {
      currentProfile.nombre = newNombre;
      currentProfile.placa = newPlaca;
      currentProfile.marca = newMarca;
      currentProfile.color = newColor;
      currentProfile.telefono = newTelefono;

      document.getElementById('editProfileForm').style.display = 'none';
      document.getElementById('editProfileBtn').style.display = 'inline-block';
      openProfile();
    }
  };
}

function generateCaptcha() {
  // Captcha para Login
  const l1 = Math.floor(Math.random() * 9) + 1;
  const l2 = Math.floor(Math.random() * 9) + 1;
  captchaAnswerLogin = l1 + l2;
  const loginQ = document.getElementById('loginCaptchaQuestion');
  if (loginQ) loginQ.textContent = `¿${l1} + ${l2}? =`;
}

async function handleSession(session) {
  if (session && session.user) {
    currentUser = session.user;

    // Cargar perfil completo
    const { data: profile, error: profileError } = await supabase
      .from('conductores')
      .select('*')
      .eq('id', currentUser.id)
      .single();

    if (profileError || !profile) {
      console.error('Error cargando perfil:', profileError);
      return handleSession(null); // Si no hay perfil, forzar login de nuevo
    }

    currentProfile = profile;
    authModal.style.display = 'none';
    document.querySelector('.fab-whatsapp').style.display = 'none'; // Ocultar en app

    // Check if new fields are missing (profile incomplete)
    if (!profile.nombre || !profile.placa || !profile.marca || !profile.color) {
      document.getElementById('completeProfileModal').style.display = 'flex';
    } else {
      proceedToApp();
    }
  } else {
    currentUser = null;
    currentProfile = null;
    authModal.style.display = 'flex';
    document.getElementById('completeProfileModal').style.display = 'none';
    mainAppContent.style.display = 'none';
    profileBtn.style.display = 'none';
    document.querySelector('.fab-whatsapp').style.display = 'flex'; // Mostrar en login
  }
}

function proceedToApp() {
  document.getElementById('completeProfileModal').style.display = 'none';
  mainAppContent.style.display = 'block';
  profileBtn.style.display = 'block';
  loadViajes();
  setupRealtimeChannel();
  initRadar();
}

async function handleSaveProfileSetup() {
  const nombre = document.getElementById('setupNombre').value.trim();
  const placa = document.getElementById('setupPlaca').value.trim();
  const marca = document.getElementById('setupMarca').value.trim();
  const color = document.getElementById('setupColor').value.trim();

  if (!nombre || !placa || !marca || !color) {
    return alert("Por favor completa todos los datos para poder trabajar.");
  }

  const btn = document.getElementById('saveCompleteProfileBtn');
  btn.textContent = "Guardando...";
  btn.disabled = true;

  const { error } = await supabase.from('conductores').update({
    nombre, placa, marca, color
  }).eq('id', currentUser.id);

  if (error) {
    alert("Hubo un error al guardar: " + error.message);
    btn.textContent = "Guardar y Empezar a Trabajar";
    btn.disabled = false;
    return;
  }

  currentProfile.nombre = nombre;
  currentProfile.placa = placa;
  currentProfile.marca = marca;
  currentProfile.color = color;

  proceedToApp();
}

async function handleLogin() {
  const telefono = document.getElementById('loginTelefono').value.trim();
  const password = document.getElementById('loginPassword').value;
  const userCaptcha = parseInt(document.getElementById('loginCaptcha').value);
  const termsElement = document.getElementById('loginTerms');
  const terms = termsElement ? termsElement.checked : true; // Fallback just in case
  const btn = document.getElementById('loginBtn');

  if (!telefono || !password) return alert('Por favor ingresa tu número y PIN.');

  if (!terms) return alert('Debes aceptar las condiciones de uso (riesgo) marcando la casilla para poder ingresar.');

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

  // Custom Auth Login — AutoRegistro incorporado
  const { data: existingUser, error: searchError } = await supabase
    .from('conductores')
    .select('*')
    .eq('telefono', telefono)
    .maybeSingle(); // maybeSingle para que no dé error si no existe

  let finalUserId = null;

  if (existingUser) {
    // Ya existe ese teléfono, verificamos que el PIN coincida
    if (existingUser.password !== password) {
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
        alert(`Teléfono o PIN incorrectos. Intento ${attempts}/${MAX_LOGIN_ATTEMPTS}.`);
        btn.textContent = 'Ingresar';
        btn.disabled = false;
      }
      generateCaptcha();
      return;
    }
    // Si la contraseña es correcta, este será el usuario
    finalUserId = existingUser.id;
  } else {
    // ── MAGIA DE AUTO-REGISTRO ──
    const newId = crypto.randomUUID();
    const { error: insertError } = await supabase
      .from('conductores')
      .insert([{ id: newId, telefono: telefono, password: password, nombre: '', placa: '', marca: '', color: '' }]);

    if (insertError) {
      alert('Hubo un error configurando tu primer ingreso: ' + insertError.message);
      btn.textContent = 'Ingresar';
      btn.disabled = false;
      generateCaptcha();
      return;
    }
    
    // Al crearse, este será el usuario
    finalUserId = newId;
  }

  // Login y Registro exitoso — limpiar contadores y guardar sesión con timestamp
  sessionStorage.removeItem('login_attempts');
  sessionStorage.removeItem('login_block_until');
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ id: finalUserId, timestamp: Date.now() }));
  window.location.reload();
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

    const marca = currentProfile.marca || 'N/A';
    const color = currentProfile.color || 'N/A';
    document.getElementById('profileVehiculo').textContent = `${marca} - ${color}`;

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

      // Promedio de calificación pública
      const conCalif = viajesTerminados.filter(v => v.calificacion && v.calificacion > 0);
      const ratingEl = document.getElementById('statRating');
      if (ratingEl) {
        if (conCalif.length > 0) {
          const promedio = (conCalif.reduce((a, v) => a + v.calificacion, 0) / conCalif.length).toFixed(1);
          ratingEl.textContent = `${promedio} ⭐ (${conCalif.length})`;
        } else {
          ratingEl.textContent = 'Sin reseñas aún';
        }
      }

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
