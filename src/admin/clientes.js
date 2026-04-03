import { supabase } from '../config/supabase.js';

async function loadClientes() {
    const listEl = document.getElementById('clientesList');
    
    // Fetch from the explicitly created table
    const { data: clientes, error } = await supabase
        .from('clientes')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Error fetching clients:', error);
        listEl.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:20px; color:red;">Error cargando clientes: ${error.message}</td></tr>`;
        return;
    }

    if (!clientes || clientes.length === 0) {
        listEl.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:30px; opacity:0.5;">Aún no hay ningún cliente registrado en el sistema.</td></tr>`;
        return;
    }

    listEl.innerHTML = clientes.map(c => {
        const date = new Date(c.created_at).toLocaleString('es-CO', {
            day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
        });
        
        return `
            <tr>
                <td style="font-weight:bold; text-transform:capitalize;">${c.nombre}</td>
                <td>${c.cedula}</td>
                <td><a href="tel:${c.telefono}" style="text-decoration:none;"><span class="phone-badge">📞 ${c.telefono}</span></a></td>
                <td style="color:rgba(255,255,255,0.5);">${date}</td>
            </tr>
        `;
    }).join('');
}

document.addEventListener('DOMContentLoaded', loadClientes);
