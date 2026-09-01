-- COOPERATIVA CIMIENTOS — MIGRACIÓN P2
-- Resoluciones automáticas, perfiles ampliados y búsquedas escalables.
-- Ejecutar después de P0, P0 addendum y P1.

create extension if not exists pg_trgm;

alter table public.perfiles_admin add column if not exists telefono text;
alter table public.perfiles_admin add column if not exists activo boolean not null default true;
alter table public.perfiles_admin add column if not exists ultimo_acceso timestamptz;

create table if not exists public.contadores_resoluciones (
  anio integer primary key,
  ultimo_numero integer not null default 0 check (ultimo_numero >= 0),
  updated_at timestamptz not null default now()
);
alter table public.contadores_resoluciones enable row level security;
revoke all on public.contadores_resoluciones from anon, authenticated;

create unique index if not exists ux_solicitudes_resolucion
  on public.solicitudes_socios (resolucion_numero)
  where resolucion_numero is not null;
create unique index if not exists ux_resoluciones_consejo_numero
  on public.resoluciones_consejo (numero);

create or replace function public.fn_siguiente_numero_resolucion(p_anio integer default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_anio integer := coalesce(p_anio, extract(year from current_date)::integer);
  v_numero integer;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if public.fn_rol_actual() not in ('superadministrador','consejo','secretaria','admision') then
    raise exception 'Tu rol no permite emitir resoluciones';
  end if;
  if exists(select 1 from public.perfiles_admin where id = auth.uid() and activo = false) then
    raise exception 'Este usuario está desactivado';
  end if;
  insert into public.contadores_resoluciones(anio, ultimo_numero)
  values (v_anio, 1)
  on conflict (anio) do update
    set ultimo_numero = public.contadores_resoluciones.ultimo_numero + 1,
        updated_at = now()
  returning ultimo_numero into v_numero;
  return 'RES-' || lpad(v_numero::text, 4, '0') || '/' || v_anio::text;
end;
$$;
revoke all on function public.fn_siguiente_numero_resolucion(integer) from public, anon;
grant execute on function public.fn_siguiente_numero_resolucion(integer) to authenticated;

create or replace function public.fn_aprobar_solicitud(
  p_id text,
  p_resolucion text default null,
  p_numero_socio text default null,
  p_notas text default null
)
returns public.solicitudes_socios
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.solicitudes_socios;
  v_numero text;
  v_proximo integer;
  v_resolucion text;
  v_email text;
  v_estado_anterior text;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if public.fn_rol_actual() not in ('superadministrador','consejo','admision') then
    raise exception 'Tu rol no permite aprobar solicitudes';
  end if;
  if exists(select 1 from public.perfiles_admin where id = auth.uid() and activo = false) then
    raise exception 'Este usuario está desactivado';
  end if;

  select * into v_row from public.solicitudes_socios where id = p_id for update;
  if not found then raise exception 'Solicitud no encontrada'; end if;
  if v_row.estado = 'aprobado' then raise exception 'La solicitud ya fue aprobada'; end if;
  v_estado_anterior := v_row.estado;

  if p_numero_socio is not null and btrim(p_numero_socio) <> '' then
    v_numero := lpad(btrim(p_numero_socio), 4, '0');
  else
    select proximo_numero_socio into v_proximo
      from public.configuracion_institucional where id = 1 for update;
    select greatest(v_proximo, coalesce(max(numero_socio::integer), 0) + 1)
      into v_proximo from public.solicitudes_socios where numero_socio ~ '^[0-9]+$';
    v_numero := lpad(v_proximo::text, 4, '0');
    update public.configuracion_institucional
      set proximo_numero_socio = v_proximo + 1, updated_at = now() where id = 1;
  end if;

  v_resolucion := coalesce(nullif(btrim(p_resolucion), ''), public.fn_siguiente_numero_resolucion(extract(year from current_date)::integer));
  select email into v_email from auth.users where id = auth.uid();

  update public.solicitudes_socios set
    estado = 'aprobado', numero_socio = v_numero,
    resolucion_numero = v_resolucion,
    notas_admin = coalesce(nullif(btrim(p_notas), ''), notas_admin),
    revisado_por = coalesce(v_email, revisado_por), fecha_revision = now()
  where id = p_id returning * into v_row;

  insert into public.auditoria_solicitudes
    (solicitud_id, accion, estado_anterior, estado_nuevo, detalle, usuario_id, usuario_email)
  values
    (p_id, 'aprobar', v_estado_anterior, 'aprobado', 'Resolución ' || v_resolucion || ' · Socio N.º ' || v_numero, auth.uid(), v_email);
  return v_row;
exception when unique_violation then
  raise exception 'La numeración entró en conflicto; volvé a confirmar la admisión';
end;
$$;
revoke all on function public.fn_aprobar_solicitud(text,text,text,text) from public, anon;
grant execute on function public.fn_aprobar_solicitud(text,text,text,text) to authenticated;

create or replace function public.fn_actualizar_estado_perfil(p_id uuid, p_activo boolean)
returns public.perfiles_admin
language plpgsql
security definer
set search_path = public
as $$
declare v_row public.perfiles_admin;
begin
  if auth.uid() is null or public.fn_rol_actual() <> 'superadministrador' then
    raise exception 'Solo un superadministrador puede activar o desactivar usuarios';
  end if;
  if p_id = auth.uid() and not p_activo then raise exception 'No podés desactivar tu propio usuario'; end if;
  update public.perfiles_admin set activo = p_activo, updated_at = now()
    where id = p_id returning * into v_row;
  if not found then raise exception 'Perfil no encontrado'; end if;
  return v_row;
end;
$$;
revoke all on function public.fn_actualizar_estado_perfil(uuid,boolean) from public, anon;
grant execute on function public.fn_actualizar_estado_perfil(uuid,boolean) to authenticated;

create index if not exists idx_solicitudes_nombre_trgm
  on public.solicitudes_socios using gin (lower(apellidos_nombres) gin_trgm_ops);
create index if not exists idx_solicitudes_cedula on public.solicitudes_socios (cedula);
create index if not exists idx_solicitudes_estado_numero on public.solicitudes_socios (estado, numero_socio);
create index if not exists idx_solicitudes_celular on public.solicitudes_socios (celular_whatsapp);

create or replace function public.fn_buscar_socios(p_busqueda text default '', p_limite integer default 50, p_offset integer default 0)
returns setof public.solicitudes_socios
language sql
security definer
set search_path = public
stable
as $$
  select s.* from public.solicitudes_socios s
  where auth.uid() is not null and s.estado = 'aprobado'
    and (coalesce(btrim(p_busqueda),'') = '' or lower(s.apellidos_nombres) like '%' || lower(btrim(p_busqueda)) || '%'
      or regexp_replace(coalesce(s.cedula,''), '\\D', '', 'g') like '%' || regexp_replace(coalesce(p_busqueda,''), '\\D', '', 'g') || '%'
      or s.numero_socio like '%' || btrim(p_busqueda) || '%'
      or regexp_replace(coalesce(s.celular_whatsapp,''), '\\D', '', 'g') like '%' || regexp_replace(coalesce(p_busqueda,''), '\\D', '', 'g') || '%')
  order by s.numero_socio nulls last
  limit least(greatest(coalesce(p_limite,50),1),100)
  offset greatest(coalesce(p_offset,0),0);
$$;
revoke all on function public.fn_buscar_socios(text,integer,integer) from public, anon;
grant execute on function public.fn_buscar_socios(text,integer,integer) to authenticated;
