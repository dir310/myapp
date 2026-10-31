/**
 * 📦 Paquetería ZIPPY — Módulo de envío de paquetes
 * Completamente independiente, no toca ningún otro módulo.
 */
import { supabase } from '../config/supabase.js';
import { generateRideCode } from '../utils/id.js';

let _currentUser = null;

/* ══════════════════════════════════════
   INIT — llamado desde main.js con el user
   ══════════════════════════════════════ */
export function initPaqueteria(userId) {
  _currentUser = userId;

  // Botón "📦 Paquetería" en sidebar
  document.getElementById('paqueteriaBtn')?.addEventListener('click', () => {
    openPaqueteriaPanel();
  });

  // Cerrar panel principal
  document.getElementById('closePaqueteriaBtn')?.addEventListener('click', closePaqueteriaPanel);

  // Cerrar con backdrop
  document.getElementById('paqueteriaModal')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('paqueteriaModal')) closePaqueteriaPanel();
  });

  // Botón nuevo paquete
  document.getElementById('nuevoPaqueteBtn')?.addEventListener('click', openPaqueteForm);

  // Cerrar formulario
  document.getElementById('closePaqueteFormBtn')?.addEventListener('click', closePaqueteForm);

  // Cerrar formulario con backdrop
  document.getElementById('paqueteFormModal')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('paqueteFormModal')) closePaqueteForm();
  });

  // Submit del formulario
  document.getElementById('paqueteFormEl')?.addEventListener('submit', handlePaqueteSubmit);

  // Preview foto
  document.getElementById('pkFotoInput')?.addEventListener('change', handleFotoPreview);
}

/* ══════════════════════════════════════
   PANEL PRINCIPAL
   ══════════════════════════════════════ */
function openPaqueteriaPanel() {
  const modal = document.getElementById('paqueteriaModal');
  if (!modal) return;
  modal.style.display = 'flex';
  loadPaquetes();

  // Cerrar sidebar
  const sidebar = document.getElementById('sidebar');
  if (sidebar && !sidebar.classList.contains('minimized')) {
    sidebar.classList.add('minimized');
  }
}

function closePaqueteriaPanel() {
  const modal = document.getElementById('paqueteriaModal');
  if (modal) modal.style.display = 'none';
}

function getUserId() {
  return _currentUser || localStorage.getItem('calmovil_cliente_id');
}

/* ══════════════════════════════════════
   FORMULARIO NUEVO PAQUETE
   ══════════════════════════════════════ */
function openPaqueteForm() {
  closePaqueteriaPanel();
  const formModal = document.getElementById('paqueteFormModal');
  if (formModal) formModal.style.display = 'flex';
  document.getElementById('paqueteFormEl')?.reset();
  const preview = document.getElementById('pkFotoPreview');
  if (preview) preview.style.display = 'none';

  // Auto-llenar datos del remitente
  const savedName = localStorage.getItem('calmovil_cliente_nombre') || '';
  const savedPhone = localStorage.getItem('calmovil_cliente_telefono') || '';
  const nameInput = document.getElementById('pkRemitenteNombre');
  const phoneInput = document.getElementById('pkRemitenteTelefono');
  if (nameInput && savedName) nameInput.value = savedName;
  if (phoneInput && savedPhone) phoneInput.value = savedPhone;
}

function closePaqueteForm() {
  const formModal = document.getElementById('paqueteFormModal');
  if (formModal) formModal.style.display = 'none';
  document.getElementById('paqueteFormEl')?.reset();
  const preview = document.getElementById('pkFotoPreview');
  if (preview) preview.style.display = 'none';
  // Reabrir panel principal
  openPaqueteriaPanel();
}

/* ══════════════════════════════════════
   CARGAR PAQUETES DEL USUARIO
   ══════════════════════════════════════ */
async function loadPaquetes() {
  const userId = getUserId();
  if (!userId) return;

  const container = document.getElementById('paquetesListContainer');
  if (!container) return;

  container.innerHTML = `
    <div style="text-align:center;padding:40px 20px;color:rgba(255,255,255,0.4);font-size:14px;">
      <span class="spinner" style="display:inline-block;border-width:3px;height:28px;width:28px;margin-bottom:14px;border-top-color:#FF6B00;"></span>
      <br>Cargando paquetes...
    </div>
  `;

  const { data, error } = await supabase
    .from('paquetes')
    .select('*')
    .eq('pasajero_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    container.innerHTML = `
      <div style="text-align:center;padding:30px 20px;color:#FF3B30;font-size:14px;">
        ⚠️ Error cargando paquetes
      </div>
    `;
    return;
  }

  if (!data || data.length === 0) {
    container.innerHTML = `
      <div class="paquetes-empty">
        <div class="paquetes-empty-icon">📦</div>
        <div class="paquetes-empty-text">No tienes envíos aún</div>
        <div class="paquetes-empty-sub">¡Envía tu primer paquete con ZIPPY!</div>
      </div>
    `;
    return;
  }

  container.innerHTML = data.map(renderPaqueteCard).join('');
}

/* ══════════════════════════════════════
   RENDER CARD
   ══════════════════════════════════════ */
function getStatusBadge(estado) {
  const badges = {
    pendiente: { label: 'Pendiente',  color: '#FF9500', bg: 'rgba(255,149,0,0.15)',    emoji: '🟡' },
    aceptado:  { label: 'Aceptado',   color: '#3498DB', bg: 'rgba(52,152,219,0.15)',   emoji: '🔵' },
    recogido:  { label: 'En Camino',  color: '#5856D6', bg: 'rgba(88,86,214,0.15)',    emoji: '🚗' },
    entregado: { label: 'Entregado',  color: '#30D158', bg: 'rgba(48,209,88,0.15)',    emoji: '✅' },
    cancelado: { label: 'Cancelado',  color: '#FF3B30', bg: 'rgba(255,59,48,0.15)',    emoji: '❌' },
  };
  return badges[estado] || badges.pendiente;
}

function getTamanoLabel(tamano) {
  const labels = {
    pequeno: '📦 Pequeño',
    mediano: '📫 Mediano',
    grande:  '🗃️ Grande',
  };
  return labels[tamano] || tamano || '—';
}

function renderPaqueteCard(p) {
  const badge = getStatusBadge(p.estado);
  const fecha = new Date(p.created_at).toLocaleDateString('es-CO', {
    day: '2-digit', month: 'short', year: 'numeric',
  });

  return `
    <div class="paquete-card">
      <div class="paquete-card-header">
        <div>
          <div class="paquete-codigo">📬 ${p.codigo_paquete || '---'}</div>
          <div class="paquete-fecha">${fecha}</div>
        </div>
        <div class="paquete-badge" style="color:${badge.color};background:${badge.bg};">
          ${badge.emoji} ${badge.label}
        </div>
      </div>
      <div class="paquete-ruta">
        <div class="paquete-ruta-item">
          <span class="paquete-ruta-dot" style="background:#30D158;"></span>
          <span>${p.origen || '—'}</span>
        </div>
        <div class="paquete-ruta-item">
          <span class="paquete-ruta-dot" style="background:#FF6B00;"></span>
          <span>${p.destino || '—'}</span>
        </div>
      </div>
      <div class="paquete-info-row">
        <span>👤 <strong>Para:</strong> ${p.destinatario_nombre || '—'} · ${p.destinatario_telefono || '—'}</span>
        <span>${getTamanoLabel(p.tamano)}</span>
      </div>
      ${p.descripcion ? `<div style="font-size:11.5px;color:rgba(255,255,255,0.4);font-style:italic;">"${p.descripcion}"</div>` : ''}
    </div>
  `;
}

/* ══════════════════════════════════════
   PREVIEW FOTO
   ══════════════════════════════════════ */
function handleFotoPreview(e) {
  const file = e.target.files[0];
  if (!file) return;
  const preview = document.getElementById('pkFotoPreview');
  if (!preview) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    preview.src = ev.target.result;
    preview.style.display = 'block';
  };
  reader.readAsDataURL(file);

  // Actualizar label
  const label = document.getElementById('pkFotoLabel');
  if (label) label.textContent = `📷 ${file.name}`;
}

/* ══════════════════════════════════════
   SUBMIT — Crear nuevo paquete
   ══════════════════════════════════════ */
async function handlePaqueteSubmit(e) {
  e.preventDefault();
  const userId = getUserId();
  if (!userId) {
    alert('Inicia sesión para enviar un paquete');
    return;
  }

  const submitBtn = document.getElementById('submitPaqueteBtn');
  const originalText = submitBtn.textContent;
  submitBtn.textContent = '⏳ Enviando...';
  submitBtn.disabled = true;

  const origen              = document.getElementById('pkOrigen').value.trim();
  const destino             = document.getElementById('pkDestino').value.trim();
  const remitenteNombre     = document.getElementById('pkRemitenteNombre').value.trim();
  const remitenteTelefono   = document.getElementById('pkRemitenteTelefono').value.trim();
  const destinatarioNombre  = document.getElementById('pkDestinatarioNombre').value.trim();
  const destinatarioTelefono = document.getElementById('pkDestinatarioTelefono').value.trim();
  const tamano              = document.getElementById('pkTamano').value;
  const descripcion         = document.getElementById('pkDescripcion').value.trim();

  // Subir foto si hay
  let fotoUrl = null;
  const fotoFile = document.getElementById('pkFotoInput')?.files[0];
  if (fotoFile) {
    const ext = fotoFile.name.split('.').pop();
    const path = `paquetes/${userId}/${Date.now()}.${ext}`;
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('paquetes-fotos')
      .upload(path, fotoFile, { upsert: true });
    if (!uploadError && uploadData) {
      const { data: urlData } = supabase.storage.from('paquetes-fotos').getPublicUrl(path);
      fotoUrl = urlData?.publicUrl || null;
    }
  }

  const codigo = 'PKT-' + generateRideCode();

  const { error } = await supabase.from('paquetes').insert({
    pasajero_id:           userId,
    origen,
    destino,
    remitente_nombre:      remitenteNombre,
    remitente_telefono:    remitenteTelefono,
    destinatario_nombre:   destinatarioNombre,
    destinatario_telefono: destinatarioTelefono,
    tamano,
    descripcion,
    foto_url:              fotoUrl,
    estado:                'pendiente',
    codigo_paquete:        codigo,
  });

  submitBtn.textContent = originalText;
  submitBtn.disabled = false;

  if (error) {
    alert('❌ Error al crear el paquete: ' + error.message);
    return;
  }

  // Cerrar form y abrir panel (ya recarga la lista)
  const formModal = document.getElementById('paqueteFormModal');
  if (formModal) formModal.style.display = 'none';
  document.getElementById('paqueteFormEl')?.reset();
  const preview = document.getElementById('pkFotoPreview');
  if (preview) preview.style.display = 'none';

  // Toast de éxito
  const toast = document.createElement('div');
  toast.style.cssText = [
    'position:fixed;top:80px;left:50%;transform:translateX(-50%);',
    'background:rgba(48,209,88,0.95);color:#fff;padding:14px 24px;',
    'border-radius:16px;font-weight:800;font-size:14px;z-index:999999;',
    'animation:slideUp 0.3s ease;white-space:nowrap;',
    'box-shadow:0 6px 24px rgba(48,209,88,0.4);',
  ].join('');
  toast.textContent = `✅ Paquete ${codigo} creado exitosamente`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);

  openPaqueteriaPanel();
}
