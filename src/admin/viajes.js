import { supabase } from '../config/supabase.js';
import { isAdminAuthenticated, showAdminPinOverlay, logoutAdmin } from './auth-admin.js';

async function loadViajes() {
    const listEl = document.getElementById('viajesList');

    // 1. Cargamos el mapa de conductores para tener los nombres disponibles
    const { data: conductores, error: condErr } = await supabase.from('conductores').select('id, nombre');
    const conductorMap = {};
    if (!condErr && conductores) {
        conductores.forEach(c => conductorMap[c.id] = c.nombre);
    }

    // 2. Consultamos los viajes ordenados por fecha descendente
    const { data: viajes, error } = await supabase
        .from('viajes')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Error fetching rides:', error);
        listEl.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:30px; color:#ff4545;">Error cargando viajes: ${error.message}</td></tr>`;
        return;
    }

    if (!viajes || viajes.length === 0) {
        listEl.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:50px; opacity:0.5;">No se han registrado viajes aún.</td></tr>`;
        return;
    }

    listEl.innerHTML = '';
    viajes.forEach(v => {
        const date = new Date(v.created_at).toLocaleString('es-CO', {
            day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
        });

        const tr = document.createElement('tr');

        // 1. Estado
        const tdEstado = document.createElement('td');
        tdEstado.innerHTML = `<span class="status-pill status-${v.estado}">${v.estado.replace('_', ' ')}</span>`;
        tr.appendChild(tdEstado);

        // 2. Código
        const tdCodigo = document.createElement('td');
        tdCodigo.innerHTML = `<span class="code-badge">#${v.codigo_viaje || 'ZIPPY'}</span>`;
        tr.appendChild(tdCodigo);

        // 3. Fecha
        const tdFecha = document.createElement('td');
        tdFecha.style.color = 'rgba(255,255,255,0.4)';
        tdFecha.textContent = date;
        tr.appendChild(tdFecha);

        // 4. Pasajero
        const tdPasajero = document.createElement('td');
        tdPasajero.innerHTML = `
            <div style="font-weight:800;">${v.cliente_nombre || 'Anónimo'}</div>
            <div style="font-size:11px; opacity:0.5; margin-top:2px;">📞 ${v.cliente_telefono || '-'}</div>
        `;
        tr.appendChild(tdPasajero);

        // 5. Conductor
        const tdConductor = document.createElement('td');
        const nombreConductor = conductorMap[v.conductor_id];
        const statusConductor = nombreConductor ? nombreConductor : (v.conductor_id ? 'Asignado' : '-');
        
        tdConductor.style.color = nombreConductor ? '#30D158' : 'rgba(255,255,255,0.3)';
        tdConductor.style.fontWeight = nombreConductor ? '700' : '400';
        tdConductor.textContent = statusConductor;
        tr.appendChild(tdConductor);

        // 6. Ruta
        const tdRuta = document.createElement('td');
        tdRuta.className = 'route-path';
        tdRuta.innerHTML = `
            <div><b>A:</b> ${v.origen_nombre}</div>
            <div style="margin-top:3px;"><b>B:</b> ${v.destino_nombre}</div>
        `;
        tr.appendChild(tdRuta);

        // 7. Valor
        const tdValor = document.createElement('td');
        tdValor.className = 'price-text';
        tdValor.textContent = `$${v.tarifa.toLocaleString('es-CO')}`;
        tr.appendChild(tdValor);

        // 8. Rating
        const tdRating = document.createElement('td');
        tdRating.style.textAlign = 'center';
        tdRating.innerHTML = v.calificacion ? `<span style="color:#FFD700; font-weight:900;">${v.calificacion}</span>` : '-';
        tr.appendChild(tdRating);

        listEl.appendChild(tr);
    });
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
    
    // Auto-refresh cada 30 segundos si la ventana está activa
    setInterval(() => {
        if (document.visibilityState === 'visible') loadViajes();
    }, 30000);
}

document.addEventListener('DOMContentLoaded', init);
