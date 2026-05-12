import { supabase } from '../config/supabase.js';

async function initPagos() {
    const list = document.getElementById('pagosList');

    // 1. Fetch Conductores
    const { data: conductores, error: cErr } = await supabase.from('conductores').select('id, nombre, telefono');
    if (cErr) {
        list.innerHTML = `<tr><td colspan="8" style="color:red;text-align:center;">Error cargando conductores: ${cErr.message}</td></tr>`;
        return;
    }

    // 2. Fetch Viajes Finalizados no liquidados
    const { data: viajes, error: vErr } = await supabase
        .from('viajes')
        .select('*')
        .eq('estado', 'finalizado')
        .is('liquidado', false);

    if (vErr) {
        list.innerHTML = `<tr><td colspan="8" style="color:#ff3b30;text-align:center;">
            <b>Error cargando viajes:</b> ${vErr.message} <br><br>
            ⚠️ Asegúrate de haber ejecutado en Supabase SQL:<br>
            <code style="background:rgba(255,255,255,.1);padding:5px;">ALTER TABLE viajes ADD COLUMN liquidado BOOLEAN DEFAULT false;</code>
        </td></tr>`;
        return;
    }

    if (!viajes || viajes.length === 0) {
        list.innerHTML = `<tr><td colspan="8" style="text-align:center;color:rgba(255,255,255,.5);">No hay viajes pendientes por liquidar. ¡Todo está al día! 🎉</td></tr>`;
        return;
    }

    // 3. Agrupar por Conductor
    const saldos = {};
    let globalWompi = 0;
    let globalCash = 0;
    let globalBonos = 0;

    viajes.forEach(v => {
        const cId = v.conductor_id;
        if (!cId) return;
        if (!saldos[cId]) {
            saldos[cId] = {
                conductor_id: cId,
                nombre: conductores.find(c => c.id === cId)?.nombre || 'Desconocido',
                viajesCount: 0,
                totalEfectivo: 0,   // Dinero real en bolsillo del conductor
                totalWompi: 0,      // Wompi cobrado (va a la app)
                totalBono: 0,       // Lo que Zippy le debe al conductor por bonos usados
                viajesIds: []
            };
        }

        const bono = v.bono_usado || 0;
        saldos[cId].viajesCount++;
        saldos[cId].viajesIds.push(v.id);

        if (v.pago_wompi) {
            // Wompi: el pasajero pagó online, tarifa completa llegó a Zippy
            saldos[cId].totalWompi += v.tarifa;
            globalWompi += v.tarifa;
        } else {
            // Efectivo: el conductor solo recibió (tarifa - bono) del pasajero
            const efectivoReal = v.tarifa - bono;
            saldos[cId].totalEfectivo += efectivoReal;
            globalCash += efectivoReal;
        }

        // Si hubo bono, Zippy le debe al conductor el 90% del bono
        if (bono > 0) {
            const bonoAConductor = Math.round(bono * 0.90);
            saldos[cId].totalBono += bonoAConductor;
            globalBonos += bonoAConductor;
        }
    });

    // Actualizar métricas globales
    document.getElementById('totalTrips').textContent = viajes.length;
    document.getElementById('totalWompi').textContent = '$' + globalWompi.toLocaleString('es-CO');
    document.getElementById('totalCash').textContent  = '$' + globalCash.toLocaleString('es-CO');
    document.getElementById('totalBonos').textContent = '$' + globalBonos.toLocaleString('es-CO');

    // 4. Renderizar tabla
    let html = '';
    for (const cId in saldos) {
        const s = saldos[cId];
        const totalBase    = s.totalEfectivo + s.totalWompi;
        const comisionApp  = Math.round(totalBase * 0.10);
        const gananciaCond = totalBase - comisionApp;  // 90% de lo recaudado

        // Saldo = lo que el conductor debería tener (ganancia) - lo que ya tiene en efectivo + lo del bono
        // Si saldo > 0: Zippy le debe al conductor
        // Si saldo < 0: conductor le debe a Zippy
        const saldoNeto = gananciaCond - s.totalEfectivo + s.totalBono;

        // Columna bono
        const bonoHTML = s.totalBono > 0
            ? `<span style="color:#3498DB;font-weight:900;">$${s.totalBono.toLocaleString('es-CO')}</span>
               <br><span style="font-size:10px;color:rgba(255,255,255,.4);">Zippy cubre el bono</span>`
            : `<span style="color:rgba(255,255,255,.2);">—</span>`;

        // Columna saldo
        let saldoHTML = '';
        if (saldoNeto > 0) {
            saldoHTML = `<span style="color:#30D158;font-weight:900;">Te toca pagarle:<br>$${saldoNeto.toLocaleString('es-CO')}</span>`;
        } else if (saldoNeto < 0) {
            saldoHTML = `<span style="color:#FF3B30;font-weight:900;">Debe a la App:<br>$${Math.abs(saldoNeto).toLocaleString('es-CO')}</span>`;
        } else {
            saldoHTML = `<span style="color:rgba(255,255,255,.5);font-weight:900;">A Paz y Salvo ($0)</span>`;
        }

        html += `
            <tr>
                <td><b>${s.nombre}</b></td>
                <td>${s.viajesCount}</td>
                <td style="color:#FFB347;">$${s.totalEfectivo.toLocaleString('es-CO')}</td>
                <td style="color:#30D158;">$${s.totalWompi.toLocaleString('es-CO')}</td>
                <td>${bonoHTML}</td>
                <td style="color:rgba(255,255,255,.6);">$${comisionApp.toLocaleString('es-CO')}</td>
                <td>${saldoHTML}</td>
                <td>
                    <button class="btn-liquidar" data-cid="${cId}" data-ids='${JSON.stringify(s.viajesIds)}'>
                        ✅ Marcar Liquidado
                    </button>
                </td>
            </tr>
        `;
    }

    list.innerHTML = html;

    // Listeners botón liquidar
    document.querySelectorAll('.btn-liquidar').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            if (!confirm('¿Estás seguro de que ya transferiste o cobraste este dinero y quieres dejar la cuenta en cero?')) return;

            const btnEl = e.currentTarget;
            btnEl.disabled = true;
            btnEl.textContent = 'Procesando...';

            const ids = JSON.parse(btnEl.getAttribute('data-ids'));

            const { error } = await supabase
                .from('viajes')
                .update({ liquidado: true })
                .in('id', ids);

            if (error) {
                alert('Error al liquidar: ' + error.message);
                btnEl.disabled = false;
                btnEl.textContent = '✅ Marcar Liquidado';
            } else {
                initPagos();
            }
        });
    });
}

document.addEventListener('DOMContentLoaded', initPagos);
