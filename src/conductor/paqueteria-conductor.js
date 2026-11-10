/**
 * 📦 Paquetería Conductor — solicitudes de envío para el driver
 * Módulo independiente, no toca viajes ni radar.
 */
import { supabase } from '../config/supabase.js';

let _conductorId = null;
let _realtimeChannel = null;
let _badgeInterval = null;

/* ═══════════════════════════════════════════
   INIT — llamado desde auth.js cuando aprobado
   ═══════════════════════════════════════════ */
export function initPaqueteriaConductor(conductorId) {
  _conductorId = conductorId;

  // Tab click listener
  const tabBtn = document.getElementById('tabPaquetes');
  if (tabBtn) {
    tabBtn.addEventListener('click', () => {
      loadPaquetesPendientes();
    });
  }

  // Suscripción Realtime a nuevos paquetes pendientes
  _realtimeChannel = supabase
    .channel('paquetes-conductor')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'paquetes' },
      () => {
        // Si la pestaña de paquetes está visible, recargar
        const panel = document.getElementById('panelPaquetes');
        if (panel && panel.style.display !== 'none') {
          loadPaquetesPendientes();
        }
        // Actualizar badge con conteo pendientes
        updatePendingBadge();
      }
    )
    .subscribe();

  // Cargar badge inicial
  updatePendingBadge();

  // Polling ligero cada 30s para badge
  _badgeInterval = setInterval(updatePendingBadge, 30000);
}

/* ═══════════════════════════════════════════
   BADGE — muestra conteo de pendientes en tab
   ═══════════════════════════════════════════ */
async function updatePendingBadge() {
  const { count } = await supabase
    .from('paquetes')
    .select('id', { count: 'exact', head: true })
    .eq('estado', 'pendiente');

  const badge = document.getElementById('paquetesBadge');
  if (!badge) return;
  if (count && count > 0) {
    badge.textContent = count;
    badge.style.display = 'inline-flex';
  } else {
    badge.style.display = 'none';
  }
}

/* ═══════════════════════════════════════════
   CARGAR LISTA DE PAQUETES PENDIENTES
   ═══════════════════════════════════════════ */
export async function loadPaquetesPendientes() {
  const container = document.getElementById('paquetesList');
  if (!container) return;

  container.innerHTML = `
    <div style="text-align:center;padding:30px 20px;color:rgba(255,255,255,0.4);font-size:14px;">
      <span class="spinner" style="display:inline-block;border-width:3px;height:26px;width:26px;margin-bottom:12px;border-top-color:#FF6B00;"></span>
      <br>Buscando paquetes...
    </div>
  `;

  // Cargar pendientes (sin conductor asignado) + los que este conductor aceptó
  const { data, error } = await supabase
    .from('paquetes')
    .select('*')
    .or(`estado.eq.pendiente,and(estado.eq.aceptado,conductor_id.eq.${_conductorId}),and(estado.eq.recogido,conductor_id.eq.${_conductorId})`)
    .order('created_at', { ascending: false })
    .limit(30);

  if (error) {
    container.innerHTML = `<div style="text-align:center;padding:20px;color:#FF3B30;">⚠️ Error cargando paquetes</div>`;
    return;
  }

  if (!data || data.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:50px 20px;">
        <div style="font-size:48px;margin-bottom:14px;opacity:0.4;">📦</div>
        <div style="color:rgba(255,255,255,0.4);font-size:14px;font-weight:600;">No hay paquetes pendientes</div>
        <div style="color:rgba(255,255,255,0.25);font-size:12px;margin-top:6px;">Cuando un pasajero solicite un envío, aparecerá aquí</div>
      </div>
    `;
    return;
  }

  container.innerHTML = data.map(renderPaqueteCard).join('');

  // Registrar eventos de los botones
  data.forEach(p => {
    const acceptBtn = document.getElementById(`acceptPkg-${p.id}`);
    const recogeBtn = document.getElementById(`recogePkg-${p.id}`);
    const entregaBtn = document.getElementById(`entregaPkg-${p.id}`);
    const rejectBtn = document.getElementById(`rejectPkg-${p.id}`);
    const fotoImg   = document.getElementById(`fotoThumb-${p.id}`);

    acceptBtn?.addEventListener('click', () => acceptarPaquete(p.id));
    recogeBtn?.addEventListener('click', () => marcarRecogido(p.id));
    entregaBtn?.addEventListener('click', () => marcarEntregado(p.id));
    rejectBtn?.addEventListener('click', () => rechazarPaquete(p.id));
    fotoImg?.addEventListener('click', () => verFotoFullscreen(p.foto_url));
  });
}

/* ═══════════════════════════════════════════
   RENDER CARD DEL PAQUETE
   ═══════════════════════════════════════════ */
function getTamanoLabel(tamano) {
  const m = { pequeno: '📦 Pequeño', mediano: '📫 Mediano', grande: '🗃️ Grande' };
  return m[tamano] || tamano || '—';
}

function renderPaqueteCard(p) {
  const esMio      = p.conductor_id === _conductorId;
  const isPendiente = p.estado === 'pendiente';
  const isAceptado  = p.estado === 'aceptado' && esMio;
  const isRecogido  = p.estado === 'recogido'  && esMio;

  const fecha = new Date(p.created_at).toLocaleDateString('es-CO', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });

  const badgeMap = {
    pendiente: { label: '🟡 Pendiente',  color: '#FF9500', bg: 'rgba(255,149,0,0.15)' },
    aceptado:  { label: '🔵 Aceptado',   color: '#3498DB', bg: 'rgba(52,152,219,0.15)' },
    recogido:  { label: '🚗 Recogido',   color: '#5856D6', bg: 'rgba(88,86,214,0.15)' },
    entregado: { label: '✅ Entregado',  color: '#30D158', bg: 'rgba(48,209,88,0.15)' },
  };
  const badge = badgeMap[p.estado] || badgeMap.pendiente;

  const fotoHtml = p.foto_url
    ? `<img id="fotoThumb-${p.id}" src="${p.foto_url}" alt="Foto paquete"
         style="width:100%;max-height:160px;object-fit:cover;border-radius:10px;cursor:pointer;margin-bottom:10px;border:1px solid rgba(255,255,255,0.1);">`
    : '';

  // Botones según estado
  let botonesHtml = '';
  if (isPendiente) {
    botonesHtml = `
      <div style="display:flex;gap:8px;margin-top:10px;">
        <button id="acceptPkg-${p.id}" style="flex:1;background:rgba(48,209,88,0.2);border:1px solid rgba(48,209,88,0.5);color:#30D158;border-radius:12px;padding:12px;font-weight:800;font-size:13px;cursor:pointer;font-family:'Inter',sans-serif;">
          ✅ Aceptar
        </button>
        <button id="rejectPkg-${p.id}" style="flex:1;background:rgba(255,59,48,0.1);border:1px solid rgba(255,59,48,0.3);color:#FF3B30;border-radius:12px;padding:12px;font-weight:800;font-size:13px;cursor:pointer;font-family:'Inter',sans-serif;">
          ❌ Rechazar
        </button>
      </div>
    `;
  } else if (isAceptado) {
    botonesHtml = `
      <button id="recogePkg-${p.id}" style="width:100%;background:rgba(88,86,214,0.2);border:1px solid rgba(88,86,214,0.5);color:#5856D6;border-radius:12px;padding:12px;font-weight:800;font-size:13px;cursor:pointer;margin-top:10px;font-family:'Inter',sans-serif;">
        🚗 Marcar como Recogido
      </button>
    `;
  } else if (isRecogido) {
    botonesHtml = `
      <button id="entregaPkg-${p.id}" style="width:100%;background:rgba(48,209,88,0.2);border:1px solid rgba(48,209,88,0.5);color:#30D158;border-radius:12px;padding:12px;font-weight:800;font-size:13px;cursor:pointer;margin-top:10px;font-family:'Inter',sans-serif;">
        ✅ Marcar como Entregado
      </button>
    `;
  }

  return `
    <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:18px;padding:14px 15px;margin-bottom:12px;">
      <!-- Header -->
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">
        <div>
          <div style="color:#FF9500;font-size:11px;font-weight:800;letter-spacing:0.5px;">📬 ${p.codigo_paquete || '---'}</div>
          <div style="color:rgba(255,255,255,0.3);font-size:10.5px;margin-top:2px;">${fecha}</div>
        </div>
        <div style="color:${badge.color};background:${badge.bg};font-size:11px;font-weight:800;padding:4px 10px;border-radius:20px;">
          ${badge.label}
        </div>
      </div>

      <!-- Foto -->
      ${fotoHtml}

      <!-- Ruta -->
      <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:10px 12px;margin-bottom:10px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;font-size:12.5px;color:rgba(255,255,255,0.8);">
          <span style="width:8px;height:8px;background:#30D158;border-radius:50%;flex-shrink:0;"></span>
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${p.origen || '—'}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;font-size:12.5px;color:rgba(255,255,255,0.8);">
          <span style="width:8px;height:8px;background:#FF6B00;border-radius:50%;flex-shrink:0;"></span>
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${p.destino || '—'}</span>
        </div>
      </div>

      <!-- Detalles paquete -->
      <div style="font-size:12px;color:rgba(255,255,255,0.5);margin-bottom:8px;">
        ${getTamanoLabel(p.tamano)}
        ${p.descripcion ? ` · <em>"${p.descripcion}"</em>` : ''}
      </div>

      <!-- Contactos -->
      <div style="display:flex;gap:8px;margin-bottom:4px;">
        <a href="tel:${p.remitente_telefono}" style="flex:1;background:rgba(52,199,89,0.1);border:1px solid rgba(52,199,89,0.3);color:#34C759;border-radius:10px;padding:8px 6px;font-size:11.5px;font-weight:700;text-decoration:none;text-align:center;">
          📞 Remitente<br><span style="font-size:10px;opacity:0.8;">${p.remitente_nombre || '—'}</span>
        </a>
        <a href="tel:${p.destinatario_telefono}" style="flex:1;background:rgba(52,152,219,0.1);border:1px solid rgba(52,152,219,0.3);color:#3498DB;border-radius:10px;padding:8px 6px;font-size:11.5px;font-weight:700;text-decoration:none;text-align:center;">
          📞 Destinatario<br><span style="font-size:10px;opacity:0.8;">${p.destinatario_nombre || '—'}</span>
        </a>
      </div>
      <div style="display:flex;gap:8px;">
        <a href="https://wa.me/57${p.remitente_telefono}" target="_blank" style="flex:1;background:rgba(37,211,102,0.1);border:1px solid rgba(37,211,102,0.3);color:#25D366;border-radius:10px;padding:7px 6px;font-size:11px;font-weight:700;text-decoration:none;text-align:center;">
          💬 WA Remitente
        </a>
        <a href="https://wa.me/57${p.destinatario_telefono}" target="_blank" style="flex:1;background:rgba(37,211,102,0.1);border:1px solid rgba(37,211,102,0.3);color:#25D366;border-radius:10px;padding:7px 6px;font-size:11px;font-weight:700;text-decoration:none;text-align:center;">
          💬 WA Destinatario
        </a>
      </div>

      <!-- Botones acción -->
      ${botonesHtml}
    </div>
  `;
}

/* ═══════════════════════════════════════════
   ACCIONES
   ═══════════════════════════════════════════ */
async function acceptarPaquete(paqueteId) {
  const btn = document.getElementById(`acceptPkg-${paqueteId}`);
  if (btn) { btn.textContent = '⏳ Aceptando...'; btn.disabled = true; }

  const { error } = await supabase
    .from('paquetes')
    .update({ estado: 'aceptado', conductor_id: _conductorId })
    .eq('id', paqueteId)
    .eq('estado', 'pendiente'); // Evita race condition

  if (error) {
    if (btn) { btn.textContent = '✅ Aceptar'; btn.disabled = false; }
    showToast('❌ Error al aceptar. Intenta de nuevo.', '#FF3B30');
    return;
  }
  showToast('✅ ¡Paquete aceptado! Recoge en la dirección de origen.', '#30D158');
  loadPaquetesPendientes();
  updatePendingBadge();
}

async function marcarRecogido(paqueteId) {
  const { error } = await supabase
    .from('paquetes')
    .update({ estado: 'recogido' })
    .eq('id', paqueteId)
    .eq('conductor_id', _conductorId);

  if (error) { showToast('❌ Error actualizando estado.', '#FF3B30'); return; }
  showToast('🚗 ¡Paquete recogido! Ve a la dirección de entrega.', '#5856D6');
  loadPaquetesPendientes();
}

async function marcarEntregado(paqueteId) {
  const { error } = await supabase
    .from('paquetes')
    .update({ estado: 'entregado' })
    .eq('id', paqueteId)
    .eq('conductor_id', _conductorId);

  if (error) { showToast('❌ Error actualizando estado.', '#FF3B30'); return; }
  showToast('✅ ¡Paquete entregado! Excelente trabajo.', '#30D158');
  loadPaquetesPendientes();
  updatePendingBadge();
}

async function rechazarPaquete(paqueteId) {
  // Solo ignorar localmente — el paquete sigue pendiente para otros conductores
  const card = document.getElementById(`acceptPkg-${paqueteId}`)?.closest('div[style]');
  if (card) {
    card.style.opacity = '0.3';
    card.style.pointerEvents = 'none';
    setTimeout(() => card.remove(), 800);
  }
}

/* ═══════════════════════════════════════════
   VER FOTO FULLSCREEN
   ═══════════════════════════════════════════ */
function verFotoFullscreen(url) {
  if (!url) return;
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:9999999;display:flex;align-items:center;justify-content:center;cursor:zoom-out;';
  overlay.innerHTML = `<img src="${url}" style="max-width:95vw;max-height:92vh;border-radius:14px;object-fit:contain;box-shadow:0 20px 60px rgba(0,0,0,0.8);">`;
  overlay.addEventListener('click', () => overlay.remove());
  document.body.appendChild(overlay);
}

/* ═══════════════════════════════════════════
   TOAST DE NOTIFICACIÓN
   ═══════════════════════════════════════════ */
function showToast(msg, color = '#30D158') {
  const t = document.createElement('div');
  t.style.cssText = [
    'position:fixed;top:80px;left:50%;transform:translateX(-50%);',
    `background:${color};color:#fff;padding:13px 22px;`,
    'border-radius:14px;font-weight:800;font-size:13.5px;z-index:999999;',
    'white-space:nowrap;box-shadow:0 6px 24px rgba(0,0,0,0.4);',
    'animation:slideUp 0.3s ease;',
  ].join('');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}
