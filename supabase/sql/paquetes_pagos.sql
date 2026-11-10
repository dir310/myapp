-- ═══════════════════════════════════════════════════════════════════════════
-- 📦 ZIPPY — Pagos y tarifas de paquetería
-- Ejecutar UNA vez en Supabase → SQL Editor (antes de publicar la app nueva).
-- Es seguro correrlo varias veces.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) Columnas nuevas ─────────────────────────────────────────────────────────
alter table public.paquetes add column if not exists origen_lat           double precision;
alter table public.paquetes add column if not exists origen_lng           double precision;
alter table public.paquetes add column if not exists destino_lat          double precision;
alter table public.paquetes add column if not exists destino_lng          double precision;
alter table public.paquetes add column if not exists distancia_km         numeric(7,2);
alter table public.paquetes add column if not exists duracion_min         integer;
alter table public.paquetes add column if not exists metodo_pago          text default 'efectivo';
alter table public.paquetes add column if not exists paga                 text default 'remitente';
alter table public.paquetes add column if not exists pagado               boolean not null default false;
alter table public.paquetes add column if not exists wompi_referencia     text;
alter table public.paquetes add column if not exists wompi_transaccion_id text;
alter table public.paquetes add column if not exists wompi_estado         text;

create unique index if not exists paquetes_wompi_referencia_key
  on public.paquetes (wompi_referencia) where wompi_referencia is not null;

-- 2) Precio mínimo aceptable según distancia en línea recta ─────────────────
--    La distancia por calles SIEMPRE es mayor o igual a la línea recta,
--    así que la tarifa real nunca puede quedar por debajo de este piso.
create or replace function public.paquete_tarifa_minima(
  o_lat double precision, o_lng double precision,
  d_lat double precision, d_lng double precision,
  p_tamano text
) returns numeric
language plpgsql immutable as $$
declare
  km numeric;
  recargo numeric;
begin
  km := 6371 * 2 * asin(sqrt(
          power(sin(radians(d_lat - o_lat) / 2), 2) +
          cos(radians(o_lat)) * cos(radians(d_lat)) *
          power(sin(radians(d_lng - o_lng) / 2), 2)));
  recargo := case p_tamano when 'mediano' then 1500 when 'grande' then 3000 else 0 end;
  return greatest(5000, recargo + greatest(4000, round((2700 + km * 1000) * 1.03) - 200));
end $$;

-- 3) Trigger de seguridad ────────────────────────────────────────────────────
--    Desde la app (anon) NADIE puede marcar un paquete como pagado, cambiar la
--    tarifa ni saltarse el pago de Wompi. Solo el servidor (service_role, usado
--    por la función wompi-webhook) puede confirmar pagos.
create or replace function public.paquetes_proteger_pagos()
returns trigger
language plpgsql as $$
begin
  -- El servidor (webhook / SQL editor) puede hacer todo
  if coalesce(auth.role(), '') = 'service_role'
     or current_user in ('postgres', 'supabase_admin', 'service_role') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.pagado := false;
    new.wompi_referencia := null;
    new.wompi_transaccion_id := null;
    new.wompi_estado := null;
    new.metodo_pago := coalesce(new.metodo_pago, 'efectivo');
    new.paga := coalesce(new.paga, 'remitente');

    if new.metodo_pago not in ('efectivo', 'wompi') then
      raise exception 'Método de pago inválido';
    end if;
    if new.paga not in ('remitente', 'destinatario') then
      raise exception 'Valor de "paga" inválido';
    end if;
    if new.metodo_pago = 'wompi' and new.paga <> 'remitente' then
      raise exception 'Con Wompi solo puede pagar el remitente';
    end if;
    if new.origen_lat is null or new.origen_lng is null
       or new.destino_lat is null or new.destino_lng is null then
      raise exception 'Faltan las coordenadas de origen o destino';
    end if;
    if new.tarifa is null
       or new.tarifa::numeric < public.paquete_tarifa_minima(
            new.origen_lat, new.origen_lng, new.destino_lat, new.destino_lng, new.tamano)
       or new.tarifa::numeric > 1000000 then
      raise exception 'Tarifa inválida, recalcula la ruta';
    end if;

    new.estado := case when new.metodo_pago = 'wompi' then 'esperando_pago' else 'pendiente' end;
    return new;
  end if;

  -- UPDATE desde la app: los campos de dinero y ruta quedan bloqueados
  new.pagado               := old.pagado;
  new.tarifa               := old.tarifa;
  new.paga                 := old.paga;
  new.wompi_referencia     := old.wompi_referencia;
  new.wompi_transaccion_id := old.wompi_transaccion_id;
  new.wompi_estado         := old.wompi_estado;
  new.origen_lat  := old.origen_lat;   new.origen_lng  := old.origen_lng;
  new.destino_lat := old.destino_lat;  new.destino_lng := old.destino_lng;

  if old.estado = 'esperando_pago' then
    -- Opciones válidas mientras espera el pago:
    --   a) cancelar   b) cambiar a efectivo (queda pendiente, el conductor cobra)
    if new.estado = 'cancelado' then
      new.metodo_pago := old.metodo_pago;
    elsif new.estado = 'pendiente' and new.metodo_pago = 'efectivo' then
      null; -- permitido
    else
      new.estado := old.estado;
      new.metodo_pago := old.metodo_pago;
    end if;
  else
    new.metodo_pago := old.metodo_pago;
    if new.estado = 'esperando_pago' then
      new.estado := old.estado;
    end if;
  end if;

  return new;
end $$;

drop trigger if exists paquetes_proteger_pagos on public.paquetes;
create trigger paquetes_proteger_pagos
  before insert or update on public.paquetes
  for each row execute function public.paquetes_proteger_pagos();
