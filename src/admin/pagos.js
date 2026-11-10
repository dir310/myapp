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
        .or('liquidado.is.null,liquidado.eq.false');

    if (vErr) {
        list.innerHTML = `<tr><td colspan="7" style="color:#ff3b30;text-align:center;">
            <b>Error cargando viajes:</b> ${vErr.message}
        </td></tr>`;
        return;
    }

    // 3. Fetch Paquetes Entregados no liquidados
    let paquetes = [];
    try {
        const { data: pkData, error: pkErr } = await supabase
            .from('paquetes')
            .select('*')
            .eq('estado', 'entregado')
            .or('liquidado.is.null,liquidado.eq.false');
        if (!pkErr && pkData) {
            paquetes = pkData;
        }
    } catch (e) {
        console.warn('[Admin Pagos] Paquetes aún sin liquidación o tabla sin columna:', e);
    }

    const totalServicios = (viajes?.length || 0) + paquetes.length;

    if (totalServicios === 0) {
        list.innerHTML = `<tr><td colspan="7" style="text-align:center;color:rgba(255,255,255,.5);">No hay viajes ni paquetes pendientes por liquidar. ¡Todo está al día! 🎉</td></tr>`;
        document.getElementById('totalTrips').textContent = '0';
        document.getElementById('totalWompi').textContent = '$0';
        document.getElementById('totalCash').textContent = '$0';
        return;
    }

    // 4. Group by Conductor
    const saldos = {};
    let globalWompi = 0;
    let globalCash = 0;

    // Procesar Viajes
    (viajes || []).forEach(v => {
        const cId = v.conductor_id;
        if (!cId) return;
        if (!saldos[cId]) {
            saldos[cId] = {
                conductor_id: cId,
                nombre: conductores.find(c => c.id === cId)?.nombre || 'Desconocido',
                viajesCount: 0,
                paquetesCount: 0,
                totalEfectivo: 0,
                totalWompi: 0,
                tarifaBrutaTotal: 0,
                totalBono: 0,
                totalMultas: 0,
                viajesIds: [],
                paquetesIds: []
            };
        }

        saldos[cId].viajesCount++;
        saldos[cId].viajesIds.push(v.id);

        const bono = v.bono_usado || 0;
        const multa = v.multa_cobrada || 0;
        const cobroReal = v.tarifa - bono;

        saldos[cId].tarifaBrutaTotal += v.tarifa;
        saldos[cId].totalBono += bono;
        saldos[cId].totalMultas += multa;

        if (v.pago_wompi) {
            saldos[cId].totalWompi += cobroReal;
            globalWompi += cobroReal;
        } else {
            saldos[cId].totalEfectivo += cobroReal;
            globalCash += cobroReal;
        }
    });

    // Procesar Paquetes
    paquetes.forEach(p => {
        const cId = p.conductor_id;
        if (!cId) return;
        if (!saldos[cId]) {
            saldos[cId] = {
                conductor_id: cId,
                nombre: conductores.find(c => c.id === cId)?.nombre || 'Desconocido',
                viajesCount: 0,
                paquetesCount: 0,
                totalEfectivo: 0,
                totalWompi: 0,
                tarifaBrutaTotal: 0,
                totalBono: 0,
                totalMultas: 0,
                viajesIds: [],
                paquetesIds: []
            };
        }

        saldos[cId].paquetesCount++;
        saldos[cId].paquetesIds.push(p.id);

        const tarifa = Number(p.tarifa || 0);
        saldos[cId].tarifaBrutaTotal += tarifa;

        if (p.metodo_pago === 'wompi' && p.pagado) {
            saldos[cId].totalWompi += tarifa;
            globalWompi += tarifa;
        } else {
            // Efectivo
            saldos[cId].totalEfectivo += tarifa;
            globalCash += tarifa;
        }
    });

    // Update global metrics
    const totalV = viajes?.length || 0;
    const totalP = paquetes.length;
    document.getElementById('totalTrips').innerHTML = `${totalServicios} <span style="font-size:12px;color:rgba(255,255,255,0.4);font-weight:normal;">(${totalV} viajes · ${totalP} paquetes)</span>`;
    document.getElementById('totalWompi').textContent = '$' + globalWompi.toLocaleString('es-CO');
    document.getElementById('totalCash').textContent = '$' + globalCash.toLocaleString('es-CO');

    // 5. Render Table
    let html = '';
    for (const cId in saldos) {
        const s = saldos[cId];
        const tarifaBruta = s.tarifaBrutaTotal || 0;
        const multas = s.totalMultas || 0;
        
        // Tarifa base sin multas para calcular el 10%
        const tarifaBase = tarifaBruta - multas;
        
        // Zippy se queda con el 10% (de viajes y paquetes) + el 100% de la multa si hubo
        const comisionApp = Math.round(tarifaBase * 0.10) + multas;
        const gananciaConductor = tarifaBruta - comisionApp;
        
        // El conductor ya tiene en su bolsillo s.totalEfectivo
        // Saldo = Lo que debería tener (Ganancia) - Lo que ya tiene (Efectivo)
        const saldoNeto = gananciaConductor - s.totalEfectivo;

        let saldoHtml = '';
        if (saldoNeto > 0) {
            saldoHtml = `<span style="color:#30D158;font-weight:900;">Te toca pagarle:<br>$${saldoNeto.toLocaleString('es-CO')}</span>`;
        } else if (saldoNeto < 0) {
            saldoHtml = `<span style="color:#FF3B30;font-weight:900;">Debe a la App:<br>$${Math.abs(saldoNeto).toLocaleString('es-CO')}</span>`;
        } else {
            saldoHtml = `<span style="color:rgba(255,255,255,.5);font-weight:900;">A Paz y Salvo ($0)</span>`;
        }

        // Detalle de servicios
        let serviciosHtml = `<strong>${s.viajesCount} viajes</strong>`;
        if (s.paquetesCount > 0) {
            serviciosHtml += `<br><span style="color:#FF9500;font-size:12px;font-weight:700;">📦 ${s.paquetesCount} paquetes</span>`;
        }

        // Detalle comisión
        let comisionHtml = `<span style="color:rgba(255,255,255,.8);font-weight:700;">$${comisionApp.toLocaleString('es-CO')}</span>`;
        if (s.totalBono && s.totalBono > 0) {
            comisionHtml += `<br><span style="font-size:10px;color:#FFB347;background:rgba(255,179,71,0.1);padding:2px 6px;border-radius:4px;border:1px solid rgba(255,179,71,0.3); display:inline-block; margin-top:4px;">🎁 Bono: $${s.totalBono.toLocaleString('es-CO')}</span>`;
        }
        if (multas > 0) {
            comisionHtml += `<br><span style="font-size:10px;color:#FF453A;background:rgba(255,69,58,0.1);padding:2px 6px;border-radius:4px;border:1px solid rgba(255,69,58,0.3); display:inline-block; margin-top:4px;">⚠️ Multa: $${multas.toLocaleString('es-CO')}</span>`;
        }

        const dataPayload = JSON.stringify({
            viajes: s.viajesIds,
            paquetes: s.paquetesIds
        });

        html += `
            <tr>
                <td><b>${s.nombre}</b></td>
                <td>${serviciosHtml}</td>
                <td style="color:#FFB347;font-weight:700;">$${s.totalEfectivo.toLocaleString('es-CO')}</td>
                <td style="color:#30D158;font-weight:700;">$${s.totalWompi.toLocaleString('es-CO')}</td>
                <td>${comisionHtml}</td>
                <td>${saldoHtml}</td>
                <td>
                    <button class="btn-liquidar" data-cid="${cId}" data-payload='${dataPayload}'>
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
            if(!confirm('¿Estás seguro de que ya transferiste o cobraste este dinero y quieres dejar la cuenta del conductor en ceros?')) return;
            
            const btnEl = e.currentTarget;
            btnEl.disabled = true;
            btnEl.textContent = 'Procesando...';
            
            const payload = JSON.parse(btnEl.getAttribute('data-payload') || '{}');
            const viajesIds = payload.viajes || [];
            const paquetesIds = payload.paquetes || [];

            let errMessage = null;

            // 1. Liquidar Viajes
            if (viajesIds.length > 0) {
                const { error: vErr } = await supabase
                    .from('viajes')
                    .update({ liquidado: true })
                    .in('id', viajesIds);
                if (vErr) errMessage = vErr.message;
            }

            // 2. Liquidar Paquetes
            if (paquetesIds.length > 0) {
                const { error: pErr } = await supabase
                    .from('paquetes')
                    .update({ liquidado: true })
                    .in('id', paquetesIds);
                if (pErr) errMessage = (errMessage ? errMessage + ' | ' : '') + pErr.message;
            }

            if (errMessage) {
                alert('Error al liquidar: ' + errMessage);
                btnEl.disabled = false;
                btnEl.textContent = '✅ Marcar Liquidado';
            } else {
                initPagos(); // Recargar tabla
            }
        });
    });
}

document.addEventListener('DOMContentLoaded', initPagos);
