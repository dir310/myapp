import { supabase } from '../config/supabase.js';
import { zippyAlert, zippyToast } from '../utils/ui-global.js';

// OneSignal Config (Mismas que en user/ride.js)
const OS_APP_ID = '07f66a98-8424-406f-b27b-edda32c256a4';
const OS_API_KEY = 'os_v2_app_2gis65wbmzb4joc37rdbmmcelv7voadc7rzexsngbh3qb6fmhcvmghh7zrgiwoskzcr6ginu5zlzs5pj5vogpnizv6xdiuf2uhpx77y';

document.addEventListener('DOMContentLoaded', async () => {
    
    // --- 1. PUSH NOTIFICATIONS ---
    const btnSendPush = document.getElementById('btnSendPush');
    btnSendPush.addEventListener('click', async () => {
        const title = document.getElementById('pushTitle').value.trim();
        const message = document.getElementById('pushMessage').value.trim();

        if (!title || !message) {
            zippyAlert('⚠️ Por favor ingresa el Título y el Mensaje de la notificación.', 'OK');
            return;
        }

        const confirm = window.confirm(`¿Estás seguro de enviar esta notificación push a TODOS los usuarios ahora mismo?\n\nTítulo: ${title}\nMensaje: ${message}`);
        if (!confirm) return;

        btnSendPush.disabled = true;
        btnSendPush.innerText = 'Enviando... 🚀';

        try {
            const response = await fetch('https://api.onesignal.com/notifications', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Key ${OS_API_KEY}`
                },
                body: JSON.stringify({
                    app_id: OS_APP_ID,
                    included_segments: ['Total Subscriptions'],
                    headings: { en: title, es: title },
                    contents: { en: message, es: message }
                })
            });

            if (response.ok) {
                zippyAlert('✅ ¡Notificación Push enviada exitosamente a todos los dispositivos!', 'Excelente');
                document.getElementById('pushTitle').value = '';
                document.getElementById('pushMessage').value = '';
            } else {
                throw new Error('Error al enviar la notificación push');
            }
        } catch (error) {
            console.error(error);
            zippyAlert('❌ Hubo un error al enviar la notificación. Revisa la consola.', 'OK');
        } finally {
            btnSendPush.disabled = false;
            btnSendPush.innerText = 'Enviar Notificación Push 🚀';
        }
    });

    // --- 2. IN-APP BANNERS ---
    let bannerId = null; // ID of the existing banner row in the database
    const bannerToggle = document.getElementById('bannerToggle');
    const bannerStatusText = document.getElementById('bannerStatusText');
    const btnSaveBanner = document.getElementById('btnSaveBanner');

    // Load current banner from Supabase
    async function loadBanner() {
        try {
            const { data, error } = await supabase.from('mensajes_globales').select('*').limit(1).single();
            if (data) {
                bannerId = data.id;
                document.getElementById('bannerTitle').value = data.titulo || '';
                document.getElementById('bannerMessage').value = data.mensaje || '';
                
                bannerToggle.checked = data.activo;
                updateToggleUI();
            }
        } catch (err) {
            console.log('No existing banner found or table does not exist yet.');
        }
    }

    function updateToggleUI() {
        if (bannerToggle.checked) {
            bannerStatusText.className = 'status-badge status-on';
            bannerStatusText.innerText = 'Activo';
        } else {
            bannerStatusText.className = 'status-badge status-off';
            bannerStatusText.innerText = 'Apagado';
        }
    }

    bannerToggle.addEventListener('change', updateToggleUI);

    btnSaveBanner.addEventListener('click', async () => {
        const title = document.getElementById('bannerTitle').value.trim();
        const message = document.getElementById('bannerMessage').value.trim();
        const isActive = bannerToggle.checked;

        if (!title || !message) {
            zippyAlert('⚠️ Por favor ingresa el Título y el Mensaje del letrero temporal.', 'OK');
            return;
        }

        btnSaveBanner.disabled = true;
        btnSaveBanner.innerText = 'Guardando... 💾';

        const payload = {
            titulo: title,
            mensaje: message,
            activo: isActive
        };

        try {
            let error;
            if (bannerId) {
                // Update existing
                const res = await supabase.from('mensajes_globales').update(payload).eq('id', bannerId);
                error = res.error;
            } else {
                // Insert new (if table was just created and is empty)
                const res = await supabase.from('mensajes_globales').insert([payload]);
                error = res.error;
                // Reload to get the new ID
                if (!error) await loadBanner();
            }

            if (error) {
                if (error.code === '42P01') {
                     zippyAlert('❌ ERROR: La tabla "mensajes_globales" no existe en Supabase. Por favor, créala primero.', 'Entendido');
                } else {
                    throw error;
                }
            } else {
                zippyAlert(`✅ Letrero temporal ${isActive ? 'ACTIVADO' : 'APAGADO y guardado'} exitosamente.`, 'Perfecto');
            }
        } catch (err) {
            console.error(err);
            zippyAlert('❌ Error al guardar el mensaje. Revisa la consola.', 'OK');
        } finally {
            btnSaveBanner.disabled = false;
            btnSaveBanner.innerText = 'Guardar Mensaje 💾';
        }
    });

    // Initialize
    loadBanner();
});
