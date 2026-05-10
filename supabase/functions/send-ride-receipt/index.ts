import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;

serve(async (req) => {
  try {
    const payload = await req.json();

    // Solo actuar cuando el viaje cambia a "finalizado"
    const viaje = payload?.record;
    if (!viaje || viaje.estado !== 'finalizado') {
      return new Response('Ignored', { status: 200 });
    }

    // Obtener email del pasajero desde Supabase
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const clienteRes = await fetch(
      `${supabaseUrl}/rest/v1/clientes?id=eq.${viaje.pasajero_id}&select=email,nombre`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
      }
    );
    const clientes = await clienteRes.json();
    const cliente = clientes?.[0];

    if (!cliente?.email) {
      return new Response('No email found', { status: 200 });
    }

    // Formatear fecha
    const fecha = new Date(viaje.created_at).toLocaleString('es-CO', {
      timeZone: 'America/Bogota',
      year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });

    // Método de pago
    const metodoPago = viaje.pago_wompi ? '💳 Pago Digital' : '💵 Efectivo';

    // HTML del recibo
    const html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Recibo de Viaje ZIPPY</title>
</head>
<body style="margin:0;padding:0;background:#0f0f1a;font-family:'Segoe UI',Arial,sans-serif;">
  <div style="max-width:520px;margin:30px auto;background:#1a1a2e;border-radius:20px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.5);">
    
    <!-- Header -->
    <div style="background:linear-gradient(135deg,#FF6B00,#FF9500);padding:30px 24px;text-align:center;">
      <div style="font-size:40px;margin-bottom:6px;">🏍️</div>
      <h1 style="color:#fff;margin:0;font-size:26px;font-weight:900;letter-spacing:-0.5px;">ZIPPY</h1>
      <p style="color:rgba(255,255,255,0.85);margin:4px 0 0;font-size:13px;font-weight:600;">Recibo de tu viaje · La Calera</p>
    </div>

    <!-- Body -->
    <div style="padding:28px 24px;">

      <p style="color:rgba(255,255,255,0.6);font-size:13px;margin:0 0 4px;">Hola,</p>
      <p style="color:#fff;font-size:18px;font-weight:800;margin:0 0 24px;">${cliente.nombre} 👋</p>

      <!-- Código del viaje -->
      <div style="background:rgba(255,107,0,0.12);border:1px solid rgba(255,107,0,0.3);border-radius:12px;padding:14px 18px;margin-bottom:16px;text-align:center;">
        <span style="color:rgba(255,255,255,0.5);font-size:10px;text-transform:uppercase;font-weight:800;display:block;">Código del Viaje</span>
        <span style="color:#FF6B00;font-size:24px;font-weight:900;letter-spacing:3px;">#${viaje.codigo_viaje || '—'}</span>
      </div>

      <!-- Detalles -->
      <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:14px;padding:18px;margin-bottom:16px;">
        
        <div style="display:flex;align-items:flex-start;margin-bottom:14px;">
          <span style="font-size:18px;margin-right:12px;">📍</span>
          <div>
            <span style="color:rgba(255,255,255,0.4);font-size:10px;text-transform:uppercase;font-weight:800;display:block;">Origen</span>
            <span style="color:#fff;font-size:13px;font-weight:600;">${viaje.origen_nombre || '—'}</span>
          </div>
        </div>

        <div style="display:flex;align-items:flex-start;margin-bottom:14px;">
          <span style="font-size:18px;margin-right:12px;">🏁</span>
          <div>
            <span style="color:rgba(255,255,255,0.4);font-size:10px;text-transform:uppercase;font-weight:800;display:block;">Destino</span>
            <span style="color:#fff;font-size:13px;font-weight:600;">${viaje.destino_nombre || '—'}</span>
          </div>
        </div>

        <div style="display:flex;align-items:flex-start;margin-bottom:14px;">
          <span style="font-size:18px;margin-right:12px;">📅</span>
          <div>
            <span style="color:rgba(255,255,255,0.4);font-size:10px;text-transform:uppercase;font-weight:800;display:block;">Fecha y Hora</span>
            <span style="color:#fff;font-size:13px;font-weight:600;">${fecha}</span>
          </div>
        </div>

        <div style="display:flex;align-items:flex-start;">
          <span style="font-size:18px;margin-right:12px;">📏</span>
          <div>
            <span style="color:rgba(255,255,255,0.4);font-size:10px;text-transform:uppercase;font-weight:800;display:block;">Distancia</span>
            <span style="color:#fff;font-size:13px;font-weight:600;">${viaje.distancia_km || '—'}</span>
          </div>
        </div>

      </div>

      <!-- Método de pago y valor -->
      <div style="background:rgba(48,209,88,0.08);border:1.5px solid rgba(48,209,88,0.25);border-radius:14px;padding:18px;display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;">
        <div>
          <span style="color:rgba(255,255,255,0.5);font-size:10px;text-transform:uppercase;font-weight:800;display:block;">Método de Pago</span>
          <span style="color:#fff;font-size:14px;font-weight:700;">${metodoPago}</span>
        </div>
        <div style="text-align:right;">
          <span style="color:rgba(255,255,255,0.5);font-size:10px;text-transform:uppercase;font-weight:800;display:block;">Total Pagado</span>
          <span style="color:#30D158;font-size:24px;font-weight:900;">$${Number(viaje.tarifa || 0).toLocaleString('es-CO')}</span>
        </div>
      </div>

      <p style="color:rgba(255,255,255,0.35);font-size:11px;text-align:center;margin:0;">
        Gracias por viajar con ZIPPY 🧡 · appzippy.com<br/>
        Si tienes algún inconveniente, contáctanos por WhatsApp.
      </p>
    </div>

    <!-- Footer -->
    <div style="background:rgba(0,0,0,0.3);padding:14px 24px;text-align:center;">
      <p style="color:rgba(255,255,255,0.2);font-size:10px;margin:0;">© 2025 ZIPPY La Calera · Todos los derechos reservados</p>
    </div>

  </div>
</body>
</html>
    `;

    // Enviar email con Resend
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'ZIPPY La Calera <onboarding@resend.dev>',
        to: [cliente.email],
        subject: `🏍️ Tu recibo de viaje ZIPPY #${viaje.codigo_viaje || ''}`,
        html,
      }),
    });

    const result = await emailRes.json();
    console.log('[ZIPPY] Email enviado:', result);

    return new Response(JSON.stringify({ success: true, result }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[ZIPPY] Error enviando recibo:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
