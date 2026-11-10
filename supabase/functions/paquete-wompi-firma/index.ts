// ═══════════════════════════════════════════════════════════════════════════
// 📦 paquete-wompi-firma
// Genera la firma de integridad de Wompi EN EL SERVIDOR para pagar un paquete.
// El secreto de integridad nunca llega al celular.
//
// Secrets necesarios (Supabase → Edge Functions → Secrets):
//   WOMPI_INTEGRITY_SECRET   (Wompi → Desarrolladores → Secretos → Integridad)
//   WOMPI_PUBLIC_KEY         (opcional, por defecto la llave pública de producción)
// ═══════════════════════════════════════════════════════════════════════════
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

async function sha256Hex(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

  try {
    const integritySecret = Deno.env.get('WOMPI_INTEGRITY_SECRET');
    const publicKey = Deno.env.get('WOMPI_PUBLIC_KEY') ?? 'pub_prod_SxZqnd7Fi3WqOdXDFGrDg0qNP0rMFtE4';
    if (!integritySecret) return json({ error: 'Pagos no configurados' }, 500);

    const { paquete_id } = await req.json();
    if (!paquete_id) return json({ error: 'Falta paquete_id' }, 400);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const headers = {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    };

    // Leer el paquete con permisos de servidor
    const res = await fetch(
      `${supabaseUrl}/rest/v1/paquetes?id=eq.${encodeURIComponent(paquete_id)}&select=id,codigo_paquete,tarifa,estado,metodo_pago,pagado`,
      { headers },
    );
    const rows = await res.json();
    const p = rows?.[0];
    if (!p) return json({ error: 'Paquete no encontrado' }, 404);
    if (p.pagado) return json({ error: 'Este paquete ya está pagado' }, 409);
    if (p.estado !== 'esperando_pago' || p.metodo_pago !== 'wompi') {
      return json({ error: 'Este paquete no está esperando pago' }, 409);
    }

    const amountInCents = Math.round(Number(p.tarifa)) * 100;
    if (!Number.isFinite(amountInCents) || amountInCents <= 0) {
      return json({ error: 'Tarifa inválida' }, 400);
    }

    // Referencia única por intento de pago
    const reference = `PKG-${p.codigo_paquete || p.id}-${Date.now()}`;
    const signature = await sha256Hex(`${reference}${amountInCents}COP${integritySecret}`);

    // Guardar la referencia para que el webhook encuentre el paquete
    const upd = await fetch(`${supabaseUrl}/rest/v1/paquetes?id=eq.${encodeURIComponent(p.id)}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ wompi_referencia: reference, wompi_estado: 'INICIADO' }),
    });
    if (!upd.ok) return json({ error: 'No se pudo preparar el pago' }, 500);

    return json({ reference, amountInCents, currency: 'COP', publicKey, signature });
  } catch (err) {
    console.error('[paquete-wompi-firma]', err);
    return json({ error: 'Error interno' }, 500);
  }
});
