-- Cooperativa Cimientos — P1 Operación multiusuario
-- Ejecutar después de supabase-migracion-p0.sql y p0-addendum.sql.
-- Todas las tablas expuestas usan RLS y grants explícitos.

begin;

-- Los roles se amplían sin usar metadata editable del usuario.
alter table public.perfiles_admin drop constraint if exists perfiles_admin_rol_check;
alter table public.perfiles_admin add constraint perfiles_admin_rol_check check (rol in (
  'superadministrador','consejo','admision','secretaria','tesoreria','atencion','auditoria','lectura'
));

create table if not exists public.tareas_operativas (
  id uuid primary key default gen_random_uuid(),
  titulo text not null check (char_length(trim(titulo)) between 2 and 180),
  socio_id text references public.solicitudes_socios(id) on delete set null,
  referencia text,
  responsable text,
  fecha_vencimiento date,
  prioridad text not null default 'normal' check (prioridad in ('normal','alta','urgente')),
  estado text not null default 'pendiente' check (estado in ('pendiente','en_curso','completada')),
  creado_por uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.documentos_socios (
  id uuid primary key default gen_random_uuid(),
  socio_id text not null references public.solicitudes_socios(id) on delete cascade,
  tipo text not null,
  estado text not null default 'vigente' check (estado in ('vigente','observado','faltante','vencido')),
  fecha_vencimiento date,
  nombre_archivo text,
  storage_path text,
  observaciones text,
  registrado_por text,
  creado_por uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.resoluciones_consejo (
  id uuid primary key default gen_random_uuid(),
  numero text not null unique,
  fecha date not null,
  sesion text,
  socio_id text references public.solicitudes_socios(id) on delete set null,
  decision text not null,
  detalle text not null,
  estado text not null default 'emitida' check (estado in ('borrador','emitida','anulada')),
  documento_path text,
  creado_por uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.movimientos_aportes (
  id uuid primary key default gen_random_uuid(),
  socio_id text not null references public.solicitudes_socios(id) on delete restrict,
  periodo text not null check (periodo ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
  fecha_pago date not null,
  aporte numeric(14,0) not null default 0 check (aporte >= 0),
  solidaridad numeric(14,0) not null default 0 check (solidaridad >= 0),
  otros numeric(14,0) not null default 0 check (otros >= 0),
  forma_pago text not null,
  recibo_numero text not null unique,
  observaciones text,
  estado text not null default 'vigente' check (estado in ('vigente','anulada')),
  registrado_por text,
  creado_por uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (aporte + solidaridad + otros > 0)
);

-- Numeración transaccional de recibos. Una secuencia evita duplicados
-- aunque dos funcionarios registren pagos al mismo tiempo.
create sequence if not exists public.recibos_numero_seq as bigint start with 1 increment by 1;
select setval(
  'public.recibos_numero_seq',
  greatest(1, coalesce((select max((regexp_match(recibo_numero, '([0-9]+)$'))[1]::bigint) from public.movimientos_aportes), 0) + 1),
  false
);

create or replace function public.fn_siguiente_numero_recibo()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.fn_rol_actual() not in ('superadministrador','tesoreria') then
    raise exception 'No tenés permisos para generar recibos';
  end if;
  return 'REC-' || lpad(nextval('public.recibos_numero_seq')::text, 6, '0');
end;
$$;

create table if not exists public.campanias (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  segmento text not null,
  canal text not null,
  mensaje text not null,
  estado text not null default 'planificada' check (estado in ('planificada','activa','finalizada','cancelada')),
  creado_por uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.auditoria_operativa (
  id bigint generated always as identity primary key,
  tabla text not null,
  registro_id text,
  accion text not null check (accion in ('INSERT','UPDATE','DELETE')),
  usuario_id uuid,
  valor_anterior jsonb,
  valor_nuevo jsonb,
  fecha timestamptz not null default now()
);

create index if not exists tareas_operativas_estado_vencimiento_idx on public.tareas_operativas(estado, fecha_vencimiento);
create index if not exists documentos_socios_socio_estado_idx on public.documentos_socios(socio_id, estado);
create index if not exists resoluciones_consejo_fecha_idx on public.resoluciones_consejo(fecha desc);
create index if not exists movimientos_aportes_socio_periodo_idx on public.movimientos_aportes(socio_id, periodo);
create index if not exists auditoria_operativa_tabla_registro_idx on public.auditoria_operativa(tabla, registro_id, fecha desc);

alter table public.tareas_operativas enable row level security;
alter table public.documentos_socios enable row level security;
alter table public.resoluciones_consejo enable row level security;
alter table public.movimientos_aportes enable row level security;
alter table public.campanias enable row level security;
alter table public.auditoria_operativa enable row level security;

revoke all on public.tareas_operativas, public.documentos_socios, public.resoluciones_consejo, public.movimientos_aportes, public.campanias, public.auditoria_operativa from anon, authenticated;
grant select, insert, update on public.tareas_operativas to authenticated;
grant select, insert, update on public.documentos_socios to authenticated;
grant select, insert, update on public.resoluciones_consejo to authenticated;
grant select, insert, update on public.movimientos_aportes to authenticated;
grant usage, select on sequence public.recibos_numero_seq to authenticated;
grant execute on function public.fn_siguiente_numero_recibo() to authenticated;
grant select, insert, update on public.campanias to authenticated;
grant select on public.auditoria_operativa to authenticated;

drop policy if exists tareas_select on public.tareas_operativas;
drop policy if exists tareas_insert on public.tareas_operativas;
drop policy if exists tareas_update on public.tareas_operativas;
create policy tareas_select on public.tareas_operativas for select to authenticated using (true);
create policy tareas_insert on public.tareas_operativas for insert to authenticated with check (public.fn_rol_actual() not in ('lectura','auditoria'));
create policy tareas_update on public.tareas_operativas for update to authenticated using (public.fn_rol_actual() not in ('lectura','auditoria')) with check (public.fn_rol_actual() not in ('lectura','auditoria'));

drop policy if exists documentos_select on public.documentos_socios;
drop policy if exists documentos_insert on public.documentos_socios;
drop policy if exists documentos_update on public.documentos_socios;
create policy documentos_select on public.documentos_socios for select to authenticated using (true);
create policy documentos_insert on public.documentos_socios for insert to authenticated with check (public.fn_rol_actual() in ('superadministrador','admision','secretaria'));
create policy documentos_update on public.documentos_socios for update to authenticated using (public.fn_rol_actual() in ('superadministrador','admision','secretaria')) with check (public.fn_rol_actual() in ('superadministrador','admision','secretaria'));

drop policy if exists resoluciones_select on public.resoluciones_consejo;
drop policy if exists resoluciones_insert on public.resoluciones_consejo;
drop policy if exists resoluciones_update on public.resoluciones_consejo;
create policy resoluciones_select on public.resoluciones_consejo for select to authenticated using (true);
create policy resoluciones_insert on public.resoluciones_consejo for insert to authenticated with check (public.fn_rol_actual() in ('superadministrador','consejo','secretaria'));
create policy resoluciones_update on public.resoluciones_consejo for update to authenticated using (public.fn_rol_actual() in ('superadministrador','consejo','secretaria')) with check (public.fn_rol_actual() in ('superadministrador','consejo','secretaria'));

drop policy if exists aportes_select on public.movimientos_aportes;
drop policy if exists aportes_insert on public.movimientos_aportes;
drop policy if exists aportes_update on public.movimientos_aportes;
create policy aportes_select on public.movimientos_aportes for select to authenticated using (true);
create policy aportes_insert on public.movimientos_aportes for insert to authenticated with check (public.fn_rol_actual() in ('superadministrador','tesoreria'));
create policy aportes_update on public.movimientos_aportes for update to authenticated using (public.fn_rol_actual() in ('superadministrador','tesoreria')) with check (public.fn_rol_actual() in ('superadministrador','tesoreria'));

drop policy if exists campanias_select on public.campanias;
drop policy if exists campanias_insert on public.campanias;
drop policy if exists campanias_update on public.campanias;
create policy campanias_select on public.campanias for select to authenticated using (true);
create policy campanias_insert on public.campanias for insert to authenticated with check (public.fn_rol_actual() in ('superadministrador','admision','atencion'));
create policy campanias_update on public.campanias for update to authenticated using (public.fn_rol_actual() in ('superadministrador','admision','atencion')) with check (public.fn_rol_actual() in ('superadministrador','admision','atencion'));

drop policy if exists auditoria_select on public.auditoria_operativa;
create policy auditoria_select on public.auditoria_operativa for select to authenticated using (public.fn_rol_actual() in ('superadministrador','auditoria'));

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.fn_auditar_operacion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Autenticación requerida'; end if;
  insert into public.auditoria_operativa(tabla, registro_id, accion, usuario_id, valor_anterior, valor_nuevo)
  values (tg_table_name, coalesce(new.id::text, old.id::text), tg_op, auth.uid(), case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end, case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end);
  return coalesce(new, old);
end;
$$;
revoke all on function private.fn_auditar_operacion() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['tareas_operativas','documentos_socios','resoluciones_consejo','movimientos_aportes','campanias'] loop
    execute format('drop trigger if exists auditar_%I on public.%I', t, t);
    execute format('create trigger auditar_%I after insert or update or delete on public.%I for each row execute function private.fn_auditar_operacion()', t, t);
  end loop;
end $$;

-- Storage: crear desde Dashboard un bucket PRIVADO llamado "expedientes".
-- Las operaciones con archivos se realizan por Storage API; no se escriben
-- registros directamente en storage.objects.
drop policy if exists expedientes_select_auth on storage.objects;
drop policy if exists expedientes_insert_admin on storage.objects;
drop policy if exists expedientes_update_admin on storage.objects;
create policy expedientes_select_auth on storage.objects for select to authenticated using (bucket_id = 'expedientes');
create policy expedientes_insert_admin on storage.objects for insert to authenticated with check (bucket_id = 'expedientes' and public.fn_rol_actual() in ('superadministrador','admision','secretaria'));
create policy expedientes_update_admin on storage.objects for update to authenticated using (bucket_id = 'expedientes' and public.fn_rol_actual() in ('superadministrador','admision','secretaria')) with check (bucket_id = 'expedientes' and public.fn_rol_actual() in ('superadministrador','admision','secretaria'));

commit;

-- Verificación mínima después de ejecutar:
-- select tablename, rowsecurity from pg_tables where schemaname='public'
-- and tablename in ('tareas_operativas','documentos_socios','resoluciones_consejo','movimientos_aportes','campanias','auditoria_operativa');
