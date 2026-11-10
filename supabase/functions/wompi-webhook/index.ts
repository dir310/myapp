// ═══════════════════════════════════════════════════════════════════════════
// 💳 wompi-webhook
// Wompi avisa aquí cuando una transacción cambia de estado.
// Solo este servidor puede marcar un paquete como PAGADO, y solo si:
//   • la firma del evento es válida (WOMPI_EVENTS_SECRET)
//   • la transacción está APPROVED
//   • el monto pagado es EXACTAMENTE la tarifa del paquete
//
// Desplegar con "Verify JWT" DESACTIVADO (Wompi no envía token de Supabase).
// Secrets: WOMPI_EVENTS_SECRET (Wompi → Desarrolladores → Secretos → Eventos)
// URL para Wompi: https://<proyecto>.supabase.co/functions/v1/wompi-webhook
//
// Ignora cualquier referencia que no empiece por "PKG-" (los viajes siguen igual).
// ═══════════════════════════════════════════════════════════════════════════
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

async function sha256Hex(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function getPath(obj: any, path: string) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

serve(async (req) => {
  if (req.method !== 'POST') return new Response('ok', { status: 200 });

  try {
    const eventsSecret = Deno.env.get('WOMPI_EVENTS_SECRET');
    if (!eventsSecret) {
      console.error('[wompi-webhook] Falta WOMPI_EVENTS_SECRET');
      return new Response('not configured', { status: 500 });
    }

    const event = await req.json();

    // 1) Verificar la firma del evento (documentación oficial de Wompi)
    const props: string[] = event?.signature?.properties ?? [];
    const concatenated =
      props.map((p) => String(getPath(event.data, p) ?? '')).join('') +
      String(event?.timestamp ?? '') +
      eventsSecret;
    const checksum = await sha256Hex(concatenated);
    const received = String(event?.signature?.checksum ?? req.headers.get('x-event-checksum') ?? '').toLowerCase();
    if (!received || checksum !== received) {
      console.warn('[wompi-webhook] Firma inválida');
      return new Response('invalid signature', { status: 401 });
    }

    if (event.event !== 'transaction.updated') return new Response('ignored', { status: 200 });

    const tx = event.data?.transaction;
    const reference: string = tx?.reference ?? '';
    if (!reference.startsWith('PKG-')) return new Response('ignored', { status: 200 });

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const headers = {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    };

    // 2) Buscar el paquete por la referencia que generó paquete-wompi-firma
    const res = await fetch(
      `${supabaseUrl}/rest/v1/paquetes?wompi_referencia=eq.${encodeURIComponent(reference)}&select=id,tarifa,estado,pagado`,
      { headers },
    );
    const p = (await res.json())?.[0];
    if (!p) {
      console.warn('[wompi-webhook] Paquete no encontrado para', reference);
      return new Response('not found', { status: 200 });
    }

    const status: string = tx.status;
    const expectedCents = Math.round(Number(p.tarifa)) * 100;
    const update: Record<string, unknown> = {
      wompi_estado: status,
      wompi_transaccion_id: tx.id ?? null,
    };

    if (status === 'APPROVED') {
      if (Number(tx.amount_in_cents) !== expectedCents || tx.currency !== 'COP') {
        console.error('[wompi-webhook] Monto no coincide', reference, tx.amount_in_cents, expectedCents);
        update.wompi_estado = 'MONTO_INVALIDO';
      } else if (!p.pagado) {
        update.pagado = true;
        // Solo pasa a "pendiente" (visible para conductores) si seguía esperando el pago
        if (p.estado === 'esperando_pago') update.estado = 'pendiente';
      }
    }

    await fetch(`${supabaseUrl}/rest/v1/paquetes?id=eq.${encodeURIComponent(p.id)}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(update),
    });

    return new Response('ok', { status: 200 });
  } catch (err) {
    console.error('[wompi-webhook]', err);
    return new Response('error', { status: 500 });
  }
});
