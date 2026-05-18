import { supabase } from '../config/supabase.js';
import { isAdminAuthenticated, showAdminPinOverlay, logoutAdmin } from './auth-admin.js';
import { zippyAlert, zippyPrompt, zippyToast } from '../utils/ui-global.js';

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
        
        try {
            const { error: updErr } = await supabase
                .from('clientes')
                .update({ estado_validacion: newStatus })
                .eq('id', c.id);
                
            if (updErr) throw updErr;

            statusTxt.textContent = check ? 'Aprobado' : 'Pendiente';
            statusTxt.className = 'status-txt ' + (check ? 'status-aprobado' : 'status-pendiente');
            
        } catch (err) {
            console.error('Error updating status:', err);
            await zippyAlert('Error guardando estado: ' + (err.message || 'Error de red'), '❌');
            input.checked = !check; // revert visual
            statusTxt.textContent = !check ? 'Aprobado' : 'Pendiente';
            statusTxt.className = 'status-txt ' + (!check ? 'status-aprobado' : 'status-pendiente');
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

    // 4.5 Billetera (Saldo Bono)
    const tdBilletera = document.createElement('td');
    let saldo = c.saldo_bono || 0;
    
    const bonoContainer = document.createElement('div');
    bonoContainer.style.cssText = 'background:rgba(52,152,219,0.1); border:1px solid rgba(52,152,219,0.3); border-radius:10px; padding:8px 12px; display:inline-block;';
    
    const saldoSpan = document.createElement('span');
    saldoSpan.style.cssText = 'color:#3498DB; font-weight:900; font-size:16px; display:block;';
    saldoSpan.textContent = `$${saldo.toLocaleString('es-CO')}`;

    const labelSpan = document.createElement('span');
    labelSpan.style.cssText = 'color:rgba(255,255,255,0.4); font-size:10px; text-transform:uppercase; display:block; margin-bottom:2px;';
    labelSpan.textContent = 'Saldo Actual';

    const giftBtn = document.createElement('button');
    giftBtn.textContent = '🎁 Bono';
    giftBtn.style.cssText = 'margin-top:8px; background:#3498DB; color:white; border:none; padding:4px 8px; border-radius:6px; font-size:10px; font-weight:800; cursor:pointer; width:100%;';
    
    giftBtn.onclick = async () => {
        const val = await zippyPrompt(`¿Cuánto saldo quieres regalarle a ${c.nombre}?`, 'Ej: 5000', '🎁', 'Regalar Bono', 'number');
        if (val !== null && val !== '') {
            const extra = parseInt(val, 10);
            if (isNaN(extra)) return;

            const finalSaldo = saldo + extra;
            giftBtn.textContent = 'Cargando...';
            giftBtn.disabled = true;

            const { error: bonoErr } = await supabase.from('clientes').update({ saldo_bono: finalSaldo }).eq('id', c.id);
            if (!bonoErr) {
                saldo = finalSaldo;
                saldoSpan.textContent = `$${saldo.toLocaleString('es-CO')}`;
                zippyToast(`¡Se cargaron $${extra.toLocaleString('es-CO')} a ${c.nombre}!`);
            } else {
                zippyAlert('Error al cargar bono: ' + bonoErr.message, '❌');
            }
            giftBtn.textContent = '🎁 Bono';
            giftBtn.disabled = false;
        }
    };

    // Multa (Deuda)
    let multa = c.multa_pendiente || 0;
    
    const multaContainer = document.createElement('div');
    multaContainer.style.cssText = 'background:rgba(255,69,58,0.08); border:1px solid rgba(255,69,58,0.2); border-radius:10px; padding:8px 12px; width: 100px;';
    
    const multaSpan = document.createElement('span');
    multaSpan.style.cssText = 'color:#FF453A; font-weight:900; font-size:16px; display:block;';
    multaSpan.textContent = `$${multa.toLocaleString('es-CO')}`;

    const labelMultaSpan = document.createElement('span');
    labelMultaSpan.style.cssText = 'color:rgba(255,255,255,0.4); font-size:10px; text-transform:uppercase; display:block; margin-bottom:2px;';
    labelMultaSpan.textContent = 'Multa PEND.';

    const editMultaBtn = document.createElement('button');
    editMultaBtn.textContent = '✏️ Editar';
    editMultaBtn.style.cssText = 'margin-top:8px; background:rgba(255,69,58,0.2); color:#FF453A; border:1px solid rgba(255,69,58,0.4); padding:4px 8px; border-radius:6px; font-size:10px; font-weight:800; cursor:pointer; width:100%;';
    
    editMultaBtn.onclick = async () => {
        const val = await zippyPrompt(`¿Ajustar multa de ${c.nombre}? (Pon 0 para perdonar)`, 'Ej: 0', '⚠️', 'Editar Multa', 'number');
        if (val !== null && val !== '') {
            const nuevaMulta = parseInt(val, 10);
            if (isNaN(nuevaMulta)) return;

            editMultaBtn.textContent = '...';
            editMultaBtn.disabled = true;

            const { error: mErr } = await supabase.from('clientes').update({ multa_pendiente: nuevaMulta }).eq('id', c.id);
            if (!mErr) {
                multa = nuevaMulta;
                multaSpan.textContent = `$${multa.toLocaleString('es-CO')}`;
                zippyToast(`¡Multa de ${c.nombre} actualizada!`);
            } else {
                zippyAlert('Error al actualizar: ' + mErr.message, '❌');
            }
            editMultaBtn.textContent = '✏️ Editar';
            editMultaBtn.disabled = false;
        }
    };

    multaContainer.appendChild(labelMultaSpan);
    multaContainer.appendChild(multaSpan);
    multaContainer.appendChild(editMultaBtn);

    const walletWrapper = document.createElement('div');
    walletWrapper.style.display = 'flex';
    walletWrapper.style.gap = '10px';
    walletWrapper.appendChild(bonoContainer);
    walletWrapper.appendChild(multaContainer);

    tdBilletera.appendChild(walletWrapper);
    tr.appendChild(tdBilletera);

    // 5. Documentos (Fotos)
    const tdDocs = document.createElement('td');
    if (c.foto_frontal_url || c.foto_trasera_url) {
        const div = document.createElement('div');
        div.style.display = 'flex';
        div.style.flexDirection = 'column';
        div.style.gap = '4px';

        const openPhoto = (path) => {
            if (!path) return;
            // Si ya es una URL completa (http), abrirla directo
            if (path.startsWith('http')) {
                window.open(path, '_blank');
                return;
            }
            // Si es ruta relativa, sacar la pública de Supabase
            const { data } = supabase.storage.from('identificaciones').getPublicUrl(path);
            window.open(data.publicUrl, '_blank');
        };

        if (c.foto_frontal_url) {
            const btnF = document.createElement('button');
            btnF.textContent = 'Frontal 📷';
            btnF.style.cssText = 'background:rgba(255,107,0,.15); border:1px solid #FF6B00; color:#FF6B00; padding:4px 8px; border-radius:4px; font-size:10px; cursor:pointer;';
            btnF.onclick = () => openPhoto(c.foto_frontal_url);
            div.appendChild(btnF);
        }
        if (c.foto_trasera_url) {
            const btnT = document.createElement('button');
            btnT.textContent = 'Trasera 📷';
            btnT.style.cssText = 'background:rgba(255,107,0,.15); border:1px solid #FF6B00; color:#FF6B00; padding:4px 8px; border-radius:4px; font-size:10px; cursor:pointer;';
            btnT.onclick = () => openPhoto(c.foto_trasera_url);
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
