import { supabase } from '../config/supabase.js';
import { isAdminAuthenticated, showAdminPinOverlay, logoutAdmin } from './auth-admin.js';

async function loadViajes() {
    const listEl = document.getElementById('viajesList');

    // 1. Cargamos el mapa de conductores y clientes para tener datos siempre disponibles
    const [ { data: conductores }, { data: clientesList } ] = await Promise.all([
        supabase.from('conductores').select('id, nombre'),
        supabase.from('clientes').select('id, nombre, telefono, cedula')
    ]);

    const conductorMap = {};
    if (conductores) conductores.forEach(c => conductorMap[c.id] = c.nombre);

    const clienteMap = {};
    if (clientesList) {
        clientesList.forEach(cl => {
            if (cl.id) clienteMap[cl.id] = cl;
            if (cl.telefono) clienteMap[cl.telefono] = cl;
        });
    }

    // 2. Consultamos tanto viajes normales en vivo como viajes agendados
    const [resNormales, resAgendados] = await Promise.all([
        supabase.from('viajes').select('*').order('created_at', { ascending: false }),
        supabase.from('viajes_agendados').select('*').order('created_at', { ascending: false })
    ]);

    if (resNormales.error && resAgendados.error) {
        console.error('Error fetching rides:', resNormales.error || resAgendados.error);
        listEl.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:30px; color:#ff4545;">Error cargando viajes: ${(resNormales.error || resAgendados.error).message}</td></tr>`;
        return;
    }

    const normales = (resNormales.data || []).map(v => {
        const cl = clienteMap[v.pasajero_id] || clienteMap[v.cliente_telefono] || {};
        return {
            id: v.id,
            tipo: 'EN VIVO',
            created_at: v.created_at,
            codigo_viaje: v.codigo_viaje || 'ZIPPY',
            estado: v.estado || 'buscando',
            cliente_nombre: v.cliente_nombre || cl.nombre || 'Pasajero',
            cliente_telefono: v.cliente_telefono || cl.telefono || '-',
            conductor_id: v.conductor_id,
            origen: v.origen_nombre || v.origen || '-',
            destino: v.destino_nombre || v.destino || '-',
            bono_usado: v.bono_usado || 0,
            tarifa: v.tarifa || 0,
            calificacion: v.calificacion,
            fecha_servicio: null
        };
    });

    const agendados = (resAgendados.data || []).map(v => {
        const cl = clienteMap[v.pasajero_id] || clienteMap[v.pasajero_telefono] || {};
        return {
            id: v.id,
            tipo: 'AGENDADO',
            created_at: v.created_at,
            codigo_viaje: v.codigo_viaje || 'AGENDADO',
            estado: v.estado || 'pendiente',
            cliente_nombre: v.pasajero_nombre || cl.nombre || 'Pasajero',
            cliente_telefono: v.pasajero_telefono || cl.telefono || '-',
            conductor_id: v.conductor_id,
            origen: v.origen || v.origen_nombre || '-',
            destino: v.destino || v.destino_nombre || '-',
            bono_usado: 0,
            tarifa: v.tarifa || 0,
            calificacion: v.calificacion,
            fecha_servicio: v.fecha_hora || v.fecha_hora_programada || v.fecha_servicio || null
        };
    });

    // 3. Unificar y ordenar por fecha de creación descendente (el más reciente arriba)
    const todosLosViajes = [...normales, ...agendados].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    if (todosLosViajes.length === 0) {
        listEl.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:50px; opacity:0.5;">No se han registrado viajes aún.</td></tr>`;
        return;
    }

    listEl.innerHTML = '';
    todosLosViajes.forEach(v => {
        const date = new Date(v.created_at).toLocaleString('es-CO', {
            day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
        });

        const tr = document.createElement('tr');

        // 1. Tipo & Estado
        const tdEstado = document.createElement('td');
        let estadoLabel = v.estado.replace('_', ' ');
        let estadoClass = `status-${v.estado}`;

        if (v.tipo === 'AGENDADO') {
            if (v.estado === 'pendiente') { estadoLabel = '⏳ Pendiente'; estadoClass = 'status-buscando'; }
            else if (v.estado === 'aceptado') { estadoLabel = '✅ Asignado'; estadoClass = 'status-aceptado'; }
            else if (v.estado === 'en_curso') { estadoLabel = '🚕 En Curso'; estadoClass = 'status-en_progreso'; }
            else if (v.estado === 'completado') { estadoLabel = '✅ Completado'; estadoClass = 'status-finalizado'; }
            else if (v.estado === 'cancelado') { estadoLabel = '❌ Cancelado'; estadoClass = 'status-cancelado'; }
        } else {
            if (v.estado === 'buscando') { estadoLabel = '⏳ Buscando'; estadoClass = 'status-buscando'; }
            else if (v.estado === 'aceptado') { estadoLabel = '🚕 Asignado'; estadoClass = 'status-aceptado'; }
            else if (v.estado === 'en_progreso') { estadoLabel = '🚀 En Progreso'; estadoClass = 'status-en_progreso'; }
            else if (v.estado === 'finalizado') { estadoLabel = '✅ Finalizado'; estadoClass = 'status-finalizado'; }
            else if (v.estado === 'cancelado') { estadoLabel = '❌ Cancelado'; estadoClass = 'status-cancelado'; }
        }

        const tipoBadge = v.tipo === 'AGENDADO'
            ? `<span style="background:rgba(52,152,219,0.15); color:#3498DB; border:1px solid rgba(52,152,219,0.4); padding:2px 6px; border-radius:4px; font-size:9px; font-weight:800; display:inline-block; margin-bottom:4px;">📅 AGENDADO</span>`
            : `<span style="background:rgba(48,209,88,0.12); color:#30D158; border:1px solid rgba(48,209,88,0.3); padding:2px 6px; border-radius:4px; font-size:9px; font-weight:800; display:inline-block; margin-bottom:4px;">🟢 EN VIVO</span>`;

        tdEstado.innerHTML = `
            ${tipoBadge}
            <div><span class="status-pill ${estadoClass}">${estadoLabel}</span></div>
        `;
        tr.appendChild(tdEstado);

        // 2. Código
        const tdCodigo = document.createElement('td');
        tdCodigo.innerHTML = `<span class="code-badge">#${v.codigo_viaje}</span>`;
        tr.appendChild(tdCodigo);

        // 3. Fecha / Hora
        const tdFecha = document.createElement('td');
        tdFecha.style.color = 'rgba(255,255,255,0.7)';
        tdFecha.style.fontSize = '12px';
        if (v.tipo === 'AGENDADO' && v.fecha_servicio) {
            const fechaServ = new Date(v.fecha_servicio).toLocaleString('es-CO', {
                day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
            });
            tdFecha.innerHTML = `<div>${date}</div><div style="font-size:10px; color:#3498DB; font-weight:700; margin-top:2px;">📅 Prog: ${fechaServ}</div>`;
        } else {
            tdFecha.textContent = date;
        }
        tr.appendChild(tdFecha);

        // 4. Pasajero
        const tdPasajero = document.createElement('td');
        tdPasajero.innerHTML = `
            <div style="font-weight:800; text-transform:capitalize;">${v.cliente_nombre}</div>
            <div style="font-size:11px; opacity:0.6; margin-top:2px;">📞 ${v.cliente_telefono}</div>
        `;
        tr.appendChild(tdPasajero);

        // 5. Conductor
        const tdConductor = document.createElement('td');
        const nombreConductor = conductorMap[v.conductor_id];
        const statusConductor = nombreConductor ? nombreConductor : (v.conductor_id ? 'Asignado' : 'Sin Asignar');
        
        tdConductor.style.color = nombreConductor ? '#30D158' : 'rgba(255,255,255,0.4)';
        tdConductor.style.fontWeight = nombreConductor ? '700' : '400';
        tdConductor.style.textTransform = 'capitalize';
        tdConductor.textContent = statusConductor;
        tr.appendChild(tdConductor);

        // 6. Ruta
        const tdRuta = document.createElement('td');
        tdRuta.className = 'route-path';
        tdRuta.innerHTML = `
            <div><b>A:</b> ${v.origen}</div>
            <div style="margin-top:3px;"><b>B:</b> ${v.destino}</div>
        `;
        tr.appendChild(tdRuta);

        // 7. Bono
        const tdBono = document.createElement('td');
        const bono = v.bono_usado || 0;
        tdBono.innerHTML = bono > 0 ? 
            `<span style="color:#3498DB; font-weight:700;">-$${bono.toLocaleString('es-CO')}</span>` : 
            '<span style="opacity:0.2;">$0</span>';
        tr.appendChild(tdBono);

        // 8. Valor Total
        const tdValor = document.createElement('td');
        tdValor.className = 'price-text';
        tdValor.textContent = `$${v.tarifa.toLocaleString('es-CO')}`;
        tr.appendChild(tdValor);

        // 9. Rating
        const tdRating = document.createElement('td');
        tdRating.style.textAlign = 'center';
        tdRating.innerHTML = v.calificacion ? `<span style="color:#FFD700; font-weight:900;">⭐ ${v.calificacion}</span>` : '<span style="opacity:0.3;">-</span>';
        tr.appendChild(tdRating);

        listEl.appendChild(tr);
    });

    // Re-aplicar filtro si ya había algo escrito
    const searchInput = document.getElementById('searchViajesInput');
    if (searchInput && searchInput.value) {
        const event = new Event('input');
        searchInput.dispatchEvent(event);
    }
}

function setupAdminControls() {
    const container = document.getElementById('adminControls');
    if (container) {
        const logoutBtn = document.createElement('button');
        logoutBtn.textContent = '🔒 Salir';
        logoutBtn.style.cssText = 'background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.15); color:rgba(255,255,255,.7); padding:8px 14px; border-radius:10px; cursor:pointer; font-size:12px; font-weight:600;';
        logoutBtn.onclick = logoutAdmin;
        container.appendChild(logoutBtn);
    }
}

async function init() {
    if (!isAdminAuthenticated()) {
        await showAdminPinOverlay();
    }
    setupAdminControls();
    loadViajes();
    
    // Configurar el buscador
    const searchInput = document.getElementById('searchViajesInput');
    if (searchInput) {
        searchInput.addEventListener('input', function() {
            const filter = this.value.toLowerCase();
            const rows = document.querySelectorAll('#viajesList tr');
            rows.forEach(row => {
                // Evitar ocultar la fila de "Cargando..." o "Error..." si no tienen celdas reales
                if (row.cells.length < 9) return; 
                
                if (row.textContent.toLowerCase().includes(filter)) {
                    row.style.display = '';
                } else {
                    row.style.display = 'none';
                }
            });
        });
    }
    
    // Auto-refresh cada 30 segundos si la ventana está activa
    setInterval(() => {
        if (document.visibilityState === 'visible') loadViajes();
    }, 30000);
}

document.addEventListener('DOMContentLoaded', init);
