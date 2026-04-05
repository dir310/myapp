import { supabase } from '../config/supabase.js';
import { isAdminAuthenticated, showAdminPinOverlay, logoutAdmin } from './auth-admin.js';

/**
 * Escapa texto para prevenir XSS — convierte caracteres especiales a entidades HTML.
 * @param {string} str
 * @returns {string}
 */
function esc(str) {
  if (str === null || str === undefined) return '-';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

async function loadClientes() {
  const listEl = document.getElementById('clientesList');

  const { data: clientes, error } = await supabase
    .from('clientes')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching clients:', error);
    listEl.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:20px; color:#ff4545;">Error cargando clientes: ${esc(error.message)}</td></tr>`;
    return;
  }

  if (!clientes || clientes.length === 0) {
    listEl.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:30px; opacity:0.5;">Aún no hay ningún cliente registrado en el sistema.</td></tr>`;
    return;
  }

  // Construir la tabla usando textContent para evitar XSS
  listEl.innerHTML = '';
  clientes.forEach(c => {
    const date = new Date(c.created_at).toLocaleString('es-CO', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    const tr = document.createElement('tr');

    // Nombre
    const tdNombre = document.createElement('td');
    tdNombre.style.fontWeight = 'bold';
    tdNombre.style.textTransform = 'capitalize';
    tdNombre.textContent = c.nombre || '-';
    tr.appendChild(tdNombre);

    // Cédula
    const tdCedula = document.createElement('td');
    tdCedula.textContent = c.cedula || '-';
    tr.appendChild(tdCedula);

    // Teléfono (link seguro)
    const tdTel = document.createElement('td');
    const a = document.createElement('a');
    a.href = `tel:${c.telefono}`;
    a.style.textDecoration = 'none';
    const badge = document.createElement('span');
    badge.className = 'phone-badge';
    badge.textContent = `📞 ${c.telefono || '-'}`;
    a.appendChild(badge);
    tdTel.appendChild(a);
    tr.appendChild(tdTel);

    // Fecha
    const tdDate = document.createElement('td');
    tdDate.style.color = 'rgba(255,255,255,0.5)';
    tdDate.textContent = date;
    tr.appendChild(tdDate);

    listEl.appendChild(tr);
  });
}

// Agregar botón de cerrar sesión admin al header
function setupLogoutBtn() {
  const header = document.querySelector('.header');
  if (header) {
    const logoutBtn = document.createElement('button');
    logoutBtn.textContent = '🔒 Cerrar Sesión Admin';
    logoutBtn.style.cssText = 'background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.15); color:rgba(255,255,255,.7); padding:8px 14px; border-radius:8px; cursor:pointer; font-size:12px; font-weight:600; font-family:Inter,sans-serif;';
    logoutBtn.onclick = logoutAdmin;
    header.appendChild(logoutBtn);
  }
}

// ── Entry point — verificar autenticación antes de cargar datos ──
async function init() {
  if (!isAdminAuthenticated()) {
    await showAdminPinOverlay();
  }
  // Solo si llegamos aquí el PIN fue correcto
  setupLogoutBtn();
  loadClientes();
}

document.addEventListener('DOMContentLoaded', init);
