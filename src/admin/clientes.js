import { supabase } from '../config/supabase.js';
import { isAdminAuthenticated, showAdminPinOverlay, logoutAdmin } from './auth-admin.js';
import { zippyAlert } from '../utils/ui-global.js';

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
      day: '2-digit', month: 'short', year: 'numeric'
    });

    const tr = document.createElement('tr');

    // 1. Estado (Aprobación) - Switch Toggle
    const tdEstado = document.createElement('td');
    const isAprobado = c.estado_validacion === 'aprobado';
    
    const label = document.createElement('label');
    label.className = 'switch';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = isAprobado;
    const span = document.createElement('span');
    span.className = 'slider';
    
    label.appendChild(input);
    label.appendChild(span);
    
    const statusTxt = document.createElement('span');
    statusTxt.className = 'status-txt ' + (isAprobado ? 'status-aprobado' : 'status-pendiente');
    statusTxt.textContent = isAprobado ? 'Aprobado' : 'Pendiente';
    
    // Toggle Event for Client Approval
    input.onchange = async (e) => {
        const check = e.target.checked;
        const newStatus = check ? 'aprobado' : 'pendiente';
        
        statusTxt.textContent = 'Guardando...';
        statusTxt.className = 'status-txt';
        
        const { error: updErr } = await supabase
            .from('clientes')
            .update({ estado_validacion: newStatus })
            .eq('id', c.id);
            
        if (updErr) {
            console.error('Error updating status:', updErr);
            zippyAlert('Error guardando estado: ' + updErr.message, '❌');
            input.checked = !check; // revert visual
            statusTxt.textContent = !check ? 'Aprobado' : 'Pendiente';
            statusTxt.className = 'status-txt ' + (!check ? 'status-aprobado' : 'status-pendiente');
        } else {
            statusTxt.textContent = check ? 'Aprobado' : 'Pendiente';
            statusTxt.className = 'status-txt ' + (check ? 'status-aprobado' : 'status-pendiente');
        }
    };

    tdEstado.appendChild(label);
    tdEstado.appendChild(statusTxt);
    tr.appendChild(tdEstado);

    // 2. Nombre
    const tdNombre = document.createElement('td');
    tdNombre.style.fontWeight = 'bold';
    tdNombre.style.textTransform = 'capitalize';
    tdNombre.textContent = c.nombre || '-';
    tr.appendChild(tdNombre);

    // 3. Contacto (Tel + Email)
    const tdContacto = document.createElement('td');
    const a = document.createElement('a');
    a.href = `tel:${c.telefono}`;
    a.style.textDecoration = 'none';
    const badge = document.createElement('span');
    badge.className = 'phone-badge';
    badge.textContent = `📞 ${c.telefono || '-'}`;
    a.appendChild(badge);
    
    const mailDiv = document.createElement('div');
    mailDiv.style.cssText = 'color:rgba(255,255,255,0.5); font-size:11px; margin-top:5px;';
    mailDiv.textContent = `📧 ${c.email || '-'}`;
    
    tdContacto.appendChild(a);
    tdContacto.appendChild(mailDiv);
    tr.appendChild(tdContacto);

    // 3.5. Clave
    const tdClave = document.createElement('td');
    tdClave.style.fontFamily = 'monospace';
    tdClave.style.fontSize = '13px';
    tdClave.style.color = '#FFD60A'; // Amarillo brillante para que resalte
    tdClave.textContent = c.password || '-';
    tr.appendChild(tdClave);

    // 4. Identidad (Cédula + Edad)
    const tdIden = document.createElement('td');
    tdIden.innerHTML = `<span style="font-weight:bold;">${esc(c.cedula)}</span><br><span style="font-size:11px; opacity:0.6;">Edad: ${c.edad} años</span>`;
    tr.appendChild(tdIden);

    // 5. Documentos (Fotos)
    const tdDocs = document.createElement('td');
    if (c.foto_frontal_url || c.foto_trasera_url) {
        const div = document.createElement('div');
        div.style.display = 'flex';
        div.style.flexDirection = 'column';
        div.style.gap = '4px';

        if (c.foto_frontal_url) {
            const btnF = document.createElement('button');
            btnF.textContent = 'Frontal 📷';
            btnF.style.cssText = 'background:rgba(255,107,0,.15); border:1px solid #FF6B00; color:#FF6B00; padding:4px 8px; border-radius:4px; font-size:10px; cursor:pointer;';
            btnF.onclick = () => window.open(c.foto_frontal_url, '_blank');
            div.appendChild(btnF);
        }
        if (c.foto_trasera_url) {
            const btnT = document.createElement('button');
            btnT.textContent = 'Trasera 📷';
            btnT.style.cssText = 'background:rgba(255,107,0,.15); border:1px solid #FF6B00; color:#FF6B00; padding:4px 8px; border-radius:4px; font-size:10px; cursor:pointer;';
            btnT.onclick = () => window.open(c.foto_trasera_url, '_blank');
            div.appendChild(btnT);
        }
        tdDocs.appendChild(div);
    } else {
        tdDocs.textContent = 'Sin fotos';
        tdDocs.style.opacity = '0.4';
        tdDocs.style.fontSize = '12px';
    }
    tr.appendChild(tdDocs);

    // 6. Registro
    const tdDate = document.createElement('td');
    tdDate.style.color = 'rgba(255,255,255,0.4)';
    tdDate.style.fontSize = '11px';
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
