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
const authModal = document.getElementById('loginOverlay');
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
  const loginSubmitBtn = document.getElementById('loginSubmitBtn');
  const registerSubmitBtn = document.getElementById('registerSubmitBtn');
  const switchToLoginBtn = document.getElementById('switchToLogin');
  const switchToRegisterBtn = document.getElementById('switchToRegister');

  if (loginSubmitBtn) loginSubmitBtn.onclick = handleLoginSubmit;
  if (registerSubmitBtn) registerSubmitBtn.onclick = handleRegisterSubmit;

  if (switchToLoginBtn) {
      switchToLoginBtn.onclick = (e) => {
          e.preventDefault();
          document.getElementById('registerView').style.display = 'none';
          document.getElementById('loginView').style.display = 'block';
      };
  }

  if (switchToRegisterBtn) {
      switchToRegisterBtn.onclick = (e) => {
          e.preventDefault();
          document.getElementById('loginView').style.display = 'none';
          document.getElementById('registerView').style.display = 'block';
      };
  }

  // Profile Sidebar toggles
  profileBtn.onclick = openProfile;
  document.getElementById('closeProfileBtn').onclick = () => profileSidebar.classList.remove('open');
  document.getElementById('logoutBtn').onclick = async () => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem('calmovil_driver_id'); // compatibilidad con sesión anterior
    localStorage.setItem('zippy_driver_logged_out', 'true'); // Bandera para mostrar login al volver
    window.location.reload();
  };

  // Edit Profile UI logic eliminada al no estar permitido


  // Botón cerrar Protocolo de Seguridad
  const closeSafetyBtn = document.getElementById('closeSafetyBtn');
  if (closeSafetyBtn) {
    closeSafetyBtn.onclick = () => {
      document.getElementById('safetyRulesModal').style.display = 'none';
      sessionStorage.setItem('zippy_safety_shown', 'true');
    };
  }
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
      // Fallback: si tenemos ID de usuario pero falló la carga del registro completo, 
      // intentamos proceder con datos mínimos en lugar de expulsar al usuario.
      if (currentUser && currentUser.id) {
        currentProfile = profile || { id: currentUser.id, nombre: 'Conductor' };
        proceedToApp();
        return;
      }
      return handleSession(null);
    }

    currentProfile = profile;
    authModal.style.display = 'none';
    document.querySelector('.fab-whatsapp').style.display = 'none'; // Ocultar en app

    proceedToApp();
  } else {
    currentUser = null;
    currentProfile = null;
    authModal.style.display = 'flex';
    mainAppContent.style.display = 'none';

    profileBtn.style.display = 'none';
    document.querySelector('.fab-whatsapp').style.display = 'flex'; // Mostrar en login

    // Logica: Si hizo logout previamente, mostrar Login; de lo contrario, Registro (Defecto)
    if (localStorage.getItem('zippy_driver_logged_out') === 'true') {
        document.getElementById('registerView').style.display = 'none';
        document.getElementById('loginView').style.display = 'block';
    } else {
        document.getElementById('registerView').style.display = 'block';
        document.getElementById('loginView').style.display = 'none';
    }
  }
}

function proceedToApp() {
  mainAppContent.style.display = 'block';
  profileBtn.style.display = 'block';
  loadViajes();
  setupRealtimeChannel();
  initRadar();

  // Validar el estado del conductor
  const estadoValidacion = currentProfile.estado_validacion || 'pendiente';
  if (estadoValidacion === 'pendiente') {
      const warning = document.getElementById('validationWarning');
      const radarBtn = document.getElementById('radarBtn');
      if (warning) warning.style.display = 'block';
      if (radarBtn) radarBtn.style.display = 'none'; // Ocultar radar, no puede trabajar
  } else {
      const warning = document.getElementById('validationWarning');
      const radarBtn = document.getElementById('radarBtn');
      if (warning) warning.style.display = 'none';
      if (radarBtn) radarBtn.style.display = 'flex';
  }

  // Mostrar Protocolo de Seguridad una vez por sesión
  if (!sessionStorage.getItem('zippy_safety_shown')) {
    const safetyModal = document.getElementById('safetyRulesModal');
    if (safetyModal) safetyModal.style.display = 'flex';
  }
}


async function handleLoginSubmit() {
  const btn = document.getElementById('loginSubmitBtn');
  const telefono = document.getElementById('loginTelefono').value.trim();
  const password = document.getElementById('loginPassword').value;
  const userCaptcha = parseInt(document.getElementById('loginCaptcha').value);
  const termsElement = document.getElementById('loginTerms');
  const terms = termsElement ? termsElement.checked : true; 

  if (!telefono || telefono.length !== 10) return alert('Por favor ingresa tu número de celular válido de 10 dígitos.');
  if (!password) return alert('Por favor ingresa tu clave.');
  if (!terms) return alert('Debes aceptar las políticas para ingresar.');
  if (isNaN(userCaptcha) || userCaptcha !== captchaAnswerLogin) {
    alert('La respuesta a la suma de seguridad es incorrecta.');
    generateCaptcha();
    return;
  }

  btn.textContent = 'Verificando...';
  btn.disabled = true;

  const { data: existingUser, error: searchError } = await supabase
    .from('conductores')
    .select('*')
    .eq('telefono', telefono)
    .maybeSingle();

  if (existingUser) {
    if (existingUser.password !== password) {
        alert('Credenciales incorrectas (Teléfono o clave no coinciden).');
        btn.textContent = 'Ingresar al Panel';
        btn.disabled = false;
        generateCaptcha();
        return;
    }
    // YA ESTÁ REGISTRADO -> Login directo
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ id: existingUser.id, timestamp: Date.now() }));
    window.location.reload();
  } else {
      alert('Esta cuenta no existe. Por favor regístrate primero.');
      btn.textContent = 'Ingresar al Panel';
      btn.disabled = false;
      generateCaptcha();
  }
}

async function handleRegisterSubmit() {
  const btn = document.getElementById('registerSubmitBtn');
  const telefono = document.getElementById('regTelefono').value.trim();
  const termsElement = document.getElementById('regTerms');
  const terms = termsElement ? termsElement.checked : true;

  if (!telefono || telefono.length !== 10) return alert('Por favor ingresa tu número de celular válido de 10 dígitos.');
  if (!terms) return alert('Debes aceptar las políticas marcando la casilla.');

  btn.textContent = 'Verificando datos...';
  btn.disabled = true;

  // 1. Verificar si el usuario ya existe
  const { data: existingUser } = await supabase
    .from('conductores')
    .select('id')
    .eq('telefono', telefono)
    .maybeSingle();

  if (existingUser) {
      alert('Este número de teléfono ya está registrado. Por favor, inicia sesión.');
      btn.textContent = 'Enviar Registro Completado';
      btn.disabled = false;
      return;
  }

  // Validaciones del formulario completo
  const regPass = document.getElementById('regPassword').value;
  const regPassConf = document.getElementById('regPasswordConfirm').value;
  
  if (regPass !== regPassConf) {
      btn.textContent = 'Enviar Registro Completado';
      btn.disabled = false;
      return alert('Las claves no coinciden.');
  }

  // Clave: exactamente 5 números y 1 mayúscula (6 caracteres totales)
  const is6Chars = regPass.length === 6;
  const has1Upper = (regPass.match(/[A-Z]/g) || []).length === 1;
  const has5Digits = (regPass.match(/\d/g) || []).length === 5;
  
  if (!is6Chars || !has1Upper || !has5Digits) {
      btn.textContent = 'Enviar Registro Completado';
      btn.disabled = false;
      return alert('La clave debe contener exactamente 1 letra mayúscula y 5 números (ejemplo: A12345).');
  }

  const n = document.getElementById('regNombre').value.trim();
  const p = document.getElementById('regPlaca').value.trim();
  const c = document.getElementById('regCorreo').value.trim();
  const d = document.getElementById('regDireccion').value.trim();
  const m = document.getElementById('regMotoDetalle').value.trim();
  
  const fProp = document.getElementById('fotoPropiedad').files ? document.getElementById('fotoPropiedad').files[0] : null;
  const fCedF = document.getElementById('fotoCedulaFrontal').files ? document.getElementById('fotoCedulaFrontal').files[0] : null;
  const fCedT = document.getElementById('fotoCedulaTrasera').files ? document.getElementById('fotoCedulaTrasera').files[0] : null;
  const fRosto = document.getElementById('fotoRostro').files ? document.getElementById('fotoRostro').files[0] : null;

  if (!n || !p || !c || !d || !m || !fProp || !fCedF || !fCedT || !fRosto) {
      btn.textContent = 'Enviar Registro Completado';
      btn.disabled = false;
      return alert('Debes llenar todos los datos y subir las 4 imágenes obligatorias de forma correcta.');
  }

  // Filtros y validaciones
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(c)) {
      btn.textContent = 'Enviar Registro Completado';
      btn.disabled = false;
      return alert('Por favor ingresa un correo electrónico válido (ejemplo@correo.com).');
  }

  btn.textContent = 'Subiendo Imágenes...';

  try {
      const uploadFile = async (file, prefix) => {
          const fileName = `${Date.now()}_conductor_${prefix}_${telefono}.png`;
          const { error } = await supabase.storage.from('identificaciones').upload(fileName, file);
          if (error) throw error;
          const { data: { publicUrl } } = supabase.storage.from('identificaciones').getPublicUrl(fileName);
          return publicUrl;
      };

      const urlProp = await uploadFile(fProp, 'propiedad');
      const urlCedF = await uploadFile(fCedF, 'cedula_frontal');
      const urlCedT = await uploadFile(fCedT, 'cedula_trasera');
      const urlRostro = await uploadFile(fRosto, 'rostro');

      btn.textContent = 'Guardando datos...';
      const newId = crypto.randomUUID();

      const { error: insertError } = await supabase.from('conductores').insert([{ 
          id: newId, 
          telefono: telefono, 
          password: regPass,
          nombre: n, 
          placa: p, 
          correo: c,
          direccion: d,
          marca_cilindraje_color: m,
          foto_propiedad_url: urlProp,
          foto_cedula_frontal_url: urlCedF,
          foto_cedula_trasera_url: urlCedT,
          foto_rostro_url: urlRostro,
          estado_validacion: 'pendiente' // Clave para bloquear el trabajo
      }]);

      if (insertError) throw insertError;

      // Registro exitoso
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ id: newId, timestamp: Date.now() }));
      window.location.reload();

  } catch (err) {
      alert('Error en el registro: ' + (err.message || 'Inténtalo de nuevo.'));
      btn.textContent = 'Enviar Registro Completado';
      btn.disabled = false;
  }
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

    const marcaColor = currentProfile.marca_cilindraje_color || (currentProfile.marca + ' - ' + currentProfile.color) || 'N/A';
    document.getElementById('profileVehiculo').textContent = marcaColor;

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
      .select('tarifa, destino_nombre, origen_nombre, calificacion')
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
