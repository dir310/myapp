import { supabase } from '../config/supabase.js';

async function initPagos() {
    const list = document.getElementById('pagosList');
    
    // 1. Fetch Conductores
    const { data: conductores, error: cErr } = await supabase.from('conductores').select('id, nombre, telefono');
    if (cErr) {
        list.innerHTML = `<tr><td colspan="7" style="color:red;text-align:center;">Error cargando conductores: ${cErr.message}</td></tr>`;
        return;
    }

    // 2. Fetch Viajes Finalizados no liquidados
    const { data: viajes, error: vErr } = await supabase
        .from('viajes')
        .select('*')
        .eq('estado', 'finalizado')
        .is('liquidado', false); // If this fails, the column liquidado is missing

    if (vErr) {
        list.innerHTML = `<tr><td colspan="7" style="color:#ff3b30;text-align:center;">
            <b>Error cargando viajes:</b> ${vErr.message} <br><br>
            ⚠️ Asegúrate de haber ejecutado en Supabase SQL:<br>
            <code style="background:rgba(255,255,255,.1);padding:5px;">ALTER TABLE viajes ADD COLUMN liquidado BOOLEAN DEFAULT false;</code>
        </td></tr>`;
        return;
    }

    if (!viajes || viajes.length === 0) {
        list.innerHTML = `<tr><td colspan="7" style="text-align:center;color:rgba(255,255,255,.5);">No hay viajes pendientes por liquidar. ¡Todo está al día! 🎉</td></tr>`;
        return;
    }

    // 3. Group by Conductor
    const saldos = {};
    let globalWompi = 0;
    let globalCash = 0;

    viajes.forEach(v => {
        const cId = v.conductor_id;
        if (!cId) return;
        if (!saldos[cId]) {
            saldos[cId] = {
                conductor_id: cId,
                nombre: conductores.find(c => c.id === cId)?.nombre || 'Desconocido',
                viajesCount: 0,
                totalEfectivo: 0,
                totalWompi: 0,
                viajesIds: []
            };
        }

        saldos[cId].viajesCount++;
        saldos[cId].viajesIds.push(v.id);

        // La tarifa ya incluye la comisión de Wompi desde el momento en que se creó el viaje.
        // El conductor gana el 90% de la tarifa cobrada al cliente (tanto efectivo como Wompi).
        if (v.pago_wompi) {
            saldos[cId].totalWompi += v.tarifa;
            globalWompi += v.tarifa;
        } else {
            saldos[cId].totalEfectivo += v.tarifa;
            globalCash += v.tarifa;
        }
    });

    // Update global metrics
    document.getElementById('totalTrips').textContent = viajes.length;
    document.getElementById('totalWompi').textContent = '$' + globalWompi.toLocaleString('es-CO');
    document.getElementById('totalCash').textContent = '$' + globalCash.toLocaleString('es-CO');

    // 4. Render Table
    let html = '';
    for (const cId in saldos) {
        const s = saldos[cId];
        const totalBase = s.totalEfectivo + s.totalWompi;
        const comisionApp = Math.round(totalBase * 0.10);
        const gananciaConductor = totalBase - comisionApp;
        
        // El conductor ya tiene en su bolsillo s.totalEfectivo
        // Saldo = Lo que debería tener (Ganancia) - Lo que ya tiene (Efectivo)
        const saldoNeto = gananciaConductor - s.totalEfectivo;

        let saldoHtml = '';
        if (saldoNeto > 0) {
            // App owes Driver (Wompi trips > App commission)
            saldoHtml = `<span style="color:#30D158;font-weight:900;">Te toca pagarle:<br>$${saldoNeto.toLocaleString('es-CO')}</span>`;
        } else if (saldoNeto < 0) {
            // Driver owes App (Cash trips > Their earnings)
            saldoHtml = `<span style="color:#FF3B30;font-weight:900;">Debe a la App:<br>$${Math.abs(saldoNeto).toLocaleString('es-CO')}</span>`;
        } else {
            saldoHtml = `<span style="color:rgba(255,255,255,.5);font-weight:900;">A Paz y Salvo ($0)</span>`;
        }

        html += `
            <tr>
                <td><b>${s.nombre}</b></td>
                <td>${s.viajesCount}</td>
                <td style="color:#FFB347;">$${s.totalEfectivo.toLocaleString('es-CO')}</td>
                <td style="color:#30D158;">$${s.totalWompi.toLocaleString('es-CO')}</td>
                <td style="color:rgba(255,255,255,.6);">$${comisionApp.toLocaleString('es-CO')}</td>
                <td>${saldoHtml}</td>
                <td>
                    <button class="btn-liquidar" data-cid="${cId}" data-ids='${JSON.stringify(s.viajesIds)}'>
                        ✅ Marcar Liquidado
                    </button>
                </td>
            </tr>
        `;
    }

    list.innerHTML = html;

    // Attach listeners
    document.querySelectorAll('.btn-liquidar').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            if(!confirm('¿Estás seguro de que ya transferiste o cobraste este dinero y quieres dejar la cuenta en cero?')) return;
            
            const btnEl = e.currentTarget;
            btnEl.disabled = true;
            btnEl.textContent = 'Procesando...';
            
            const ids = JSON.parse(btnEl.getAttribute('data-ids'));
            
            // Actualizar viajes
            const { error } = await supabase
                .from('viajes')
                .update({ liquidado: true })
                .in('id', ids);

            if (error) {
                alert('Error al liquidar: ' + error.message);
                btnEl.disabled = false;
                btnEl.textContent = '✅ Marcar Liquidado';
            } else {
                initPagos(); // Recargar tabla
            }
        });
    });
}

document.addEventListener('DOMContentLoaded', initPagos);
