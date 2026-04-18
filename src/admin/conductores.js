import { supabase } from '../config/supabase.js';
import { isAdminAuthenticated, showAdminPinOverlay, logoutAdmin } from './auth-admin.js';

/**
 * Escapa texto para prevenir XSS.
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

async function loadConductores() {
  const listEl = document.getElementById('conductoresList');

  const { data: conductores, error } = await supabase
    .from('conductores')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching conductores:', error);
    listEl.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:20px; color:#ff4545;">Error cargando conductores: ${esc(error.message)}</td></tr>`;
    return;
  }

  if (!conductores || conductores.length === 0) {
    listEl.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:30px; opacity:0.5;">Aún no hay ningún conductor registrado en el sistema.</td></tr>`;
    return;
  }

  listEl.innerHTML = '';
  conductores.forEach(c => {
    const tr = document.createElement('tr');

    // 1. Estado (Acceso) - Switch Toggle
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
    
    // Toggle Event
    input.onchange = async (e) => {
        const check = e.target.checked;
        const newStatus = check ? 'aprobado' : 'pendiente';
        
        statusTxt.textContent = 'Guardando...';
        statusTxt.className = 'status-txt';
        
        const { error: updErr } = await supabase
            .from('conductores')
            .update({ estado_validacion: newStatus })
            .eq('id', c.id);
            
        if (updErr) {
            alert('Error guardando estado: ' + updErr.message);
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

    // 2. Nombre Conductor
    const tdNombre = document.createElement('td');
    tdNombre.style.fontWeight = 'bold';
    tdNombre.style.textTransform = 'capitalize';
    tdNombre.textContent = c.nombre || '-';
    tr.appendChild(tdNombre);

    // 3. Datos de Contacto (Tel + Mail + Dir)
    const tdContacto = document.createElement('td');
    const a = document.createElement('a');
    a.href = `tel:${c.telefono}`;
    a.style.textDecoration = 'none';
    const badge = document.createElement('span');
    badge.className = 'phone-badge';
    badge.textContent = `📞 ${c.telefono || '-'}`;
    a.appendChild(badge);
    
    const metaDiv = document.createElement('div');
    metaDiv.style.cssText = 'color:rgba(255,255,255,0.6); font-size:11px; margin-top:5px;';
    metaDiv.innerHTML = `📧 ${esc(c.correo)}<br>📍 ${esc(c.direccion)}`;
    
    tdContacto.appendChild(a);
    tdContacto.appendChild(metaDiv);
    tr.appendChild(tdContacto);

    // 4. Clave
    const tdClave = document.createElement('td');
    tdClave.innerHTML = `<span style="font-family:monospace; background:rgba(0,0,0,0.5); padding:4px 8px; border-radius:4px; border:1px solid rgba(255,255,255,0.1); color:#ffb347; letter-spacing:1px;">${esc(c.password)}</span>`;
    tr.appendChild(tdClave);

    // 5. Info Vehículo
    const tdVehiculo = document.createElement('td');
    tdVehiculo.innerHTML = `<span style="color:#FF6B00; font-weight:bold;">Placa: ${esc(c.placa)}</span><br><span style="font-size:11px; color:rgba(255,255,255,0.6);">${esc(c.marca_cilindraje_color)}</span>`;
    tr.appendChild(tdVehiculo);

    // 6. Documentos (Fotos)
    const tdDocs = document.createElement('td');
    const div = document.createElement('div');
    div.style.display = 'flex';
    div.style.flexWrap = 'wrap';
    div.style.gap = '5px';
    div.style.maxWidth = '180px';
    
    const docsArr = [
        { name: 'Propiedad', url: c.foto_propiedad_url },
        { name: 'C. Frontal', url: c.foto_cedula_frontal_url },
        { name: 'C. Trasera', url: c.foto_cedula_trasera_url },
        { name: 'Rostro', url: c.foto_rostro_url }
    ];

    let hasDocs = false;
    docsArr.forEach(d => {
        if (d.url) {
            hasDocs = true;
            const btn = document.createElement('button');
            btn.textContent = `${d.name} 📷`;
            btn.style.cssText = 'background:rgba(255,107,0,.15); border:1px solid #FF6B00; color:#FF6B00; padding:4px 8px; border-radius:4px; font-size:10px; cursor:pointer; flex: 1 1 40%; text-align:center;';
            btn.onclick = () => window.open(d.url, '_blank');
            div.appendChild(btn);
        }
    });

    if (hasDocs) tdDocs.appendChild(div);
    else tdDocs.innerHTML = '<span style="opacity:0.4; font-size:12px;">Sin fotos</span>';
    
    tr.appendChild(tdDocs);

    listEl.appendChild(tr);
  });
}

// Agregar botón de cerrar sesión
function setupLogoutBtn() {
  const header = document.querySelector('.header');
  if (header) {
    const logoutBtn = document.createElement('button');
    logoutBtn.textContent = '🔒 Salir del Admin';
    logoutBtn.style.cssText = 'position:absolute; top:20px; right:20px; background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.15); color:rgba(255,255,255,.7); padding:8px 14px; border-radius:8px; cursor:pointer; font-size:12px; font-weight:600; font-family:Inter,sans-serif;';
    logoutBtn.onclick = logoutAdmin;
    header.appendChild(logoutBtn);
  }
}

async function init() {
  // Reutilizamos el PIN y la lógica de validación del panel de clientes
  if (!isAdminAuthenticated()) {
    await showAdminPinOverlay();
  }
  setupLogoutBtn();
  loadConductores();
}

document.addEventListener('DOMContentLoaded', init);
