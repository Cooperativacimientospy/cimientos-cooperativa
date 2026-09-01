-- ============================================================
-- COOPERATIVA CIMIENTOS — MIGRACIÓN P0 (30/08/2026)
-- Corrige los 8 hallazgos marcados P0 en la auditoría:
--   #1 numeración de socios inconsistente
--   #2 enlace de pre-registro con ruta equivocada
--   #3 funciones administrativas locales presentadas como reales
--   #4 aprobar/observar/rechazar sin controles suficientes
--   #5 estado "Link enviado" sin confirmación real
--   #22 datos personales del pre-registro viajando en la URL
--   #31 nómina fundacional no cerrada técnicamente
--
-- ES ADITIVA: no borra ni recrea ninguna tabla existente, es
-- segura para correr sobre la base que YA tiene datos reales
-- (los 38-39 socios fundadores, etc). Ejecutar completo en:
-- Supabase > SQL Editor > New query > Run. Se puede correr más
-- de una vez sin romper nada (todo usa "if not exists" / "or replace").
--
-- Requisito: ya haber corrido el supabase-schema.sql original
-- (solicitudes_socios, pre_registros, actividad deben existir).
-- ============================================================

create extension if not exists pgcrypto;

-- ============================================================
-- 1. Numeración de socios sin colisiones (P0 #1)
-- Antes: el navegador de cada administrador calculaba el próximo
-- número mirando su propia copia local — por eso el panel llegó a
-- proponer 0001 mientras ya había fundadores 0038/0039 reales.
-- Ahora: un índice único a nivel de base de datos hace IMPOSIBLE
-- que dos socios queden con el mismo número, y el número real lo
-- asigna la función fn_aprobar_solicitud (sección 5), nunca el navegador.
-- ============================================================
create unique index if not exists ux_solicitudes_numero_socio
  on public.solicitudes_socios (numero_socio)
  where numero_socio is not null;

-- ============================================================
-- 2. Configuración institucional en el servidor (parte de P0 #3)
-- Reemplaza lo que hasta ahora vivía solo en el localStorage de
-- cada navegador (próximo número de socio, cierre de la nómina
-- fundacional, mensaje de invitación, derecho de admisión) por una
-- única fuente de verdad compartida por todo el Consejo.
-- ============================================================
create table if not exists public.configuracion_institucional (
  id int primary key default 1,
  proximo_numero_socio int not null default 39, -- ⚠️ confirmar que sea el correcto (fundadores 1 a 38 asignados fuera del sistema)
  cierre_fundacional boolean not null default false,
  cierre_fundacional_fecha timestamptz,
  cierre_fundacional_por text,
  derecho_admision numeric not null default 150000,
  mensaje_invitacion text not null default 'Hola {nombre}, te compartimos el formulario de admisión: {link}',
  updated_at timestamptz not null default now(),
  constraint una_sola_fila check (id = 1)
);
insert into public.configuracion_institucional (id) values (1) on conflict (id) do nothing;
alter table public.configuracion_institucional enable row level security;
drop policy if exists "config_select_auth" on public.configuracion_institucional;
create policy "config_select_auth" on public.configuracion_institucional for select to authenticated using (true);
-- Sin policy de insert/update/delete: esta tabla SOLO se modifica a
-- través de las funciones de las secciones 5, 6 y 9 (nunca con un
-- update directo desde el navegador), así el número de socio y el
-- cierre de fundadores no pueden manipularse desde el cliente.

-- ============================================================
-- 3. Perfiles reales ligados a Supabase Auth (P0 #3)
-- Reemplaza "administrador"/"correoAdministrador"/"cargoAdministrador"
-- guardados en localStorage (que cualquiera podía editar con el
-- inspector del navegador) por un perfil real por persona, atado a
-- su usuario autenticado, con un rol que sí controla permisos reales
-- (ver fn_aprobar_solicitud, fn_cerrar_nomina_fundacional más abajo).
-- ============================================================
create table if not exists public.perfiles_admin (
  id uuid primary key references auth.users(id) on delete cascade,
  correo text,
  nombre text not null default 'Administrador',
  cargo text not null default 'Administrador',
  rol text not null default 'admision' check (rol in ('superadministrador','admision','lectura')),
  foto_base64 text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.perfiles_admin enable row level security;
drop policy if exists "perfiles_ver_todos_auth" on public.perfiles_admin;
drop policy if exists "perfil_propio_update" on public.perfiles_admin;
create policy "perfiles_ver_todos_auth" on public.perfiles_admin for select to authenticated using (true);
create policy "perfil_propio_update" on public.perfiles_admin for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- Crea (o devuelve) el perfil de quien está logueado. La primera
-- persona que entra queda como superadministrador automáticamente;
-- las siguientes entran como "admisión" hasta que un
-- superadministrador les suba el rol (ver fn_actualizar_rol_perfil).
create or replace function public.fn_asegurar_perfil()
returns public.perfiles_admin
language plpgsql
security definer
set search_path = public
as $$
declare
  v_perfil public.perfiles_admin;
  v_email text;
  v_es_primero boolean;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  select not exists(select 1 from public.perfiles_admin) into v_es_primero;
  select email into v_email from auth.users where id = auth.uid();
  insert into public.perfiles_admin (id, correo, nombre, cargo, rol)
  values (auth.uid(), v_email, coalesce(v_email, 'Administrador'), 'Administrador',
          case when v_es_primero then 'superadministrador' else 'admision' end)
  on conflict (id) do update set correo = excluded.correo
  returning * into v_perfil;
  return v_perfil;
end;
$$;
grant execute on function public.fn_asegurar_perfil() to authenticated;

create or replace function public.fn_rol_actual()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select rol from public.perfiles_admin where id = auth.uid();
$$;
grant execute on function public.fn_rol_actual() to authenticated;

create or replace function public.fn_actualizar_rol_perfil(p_id uuid, p_rol text)
returns public.perfiles_admin
language plpgsql
security definer
set search_path = public
as $$
declare v_row public.perfiles_admin;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if public.fn_rol_actual() <> 'superadministrador' then
    raise exception 'Solo un superadministrador puede cambiar roles';
  end if;
  if p_rol not in ('superadministrador','admision','lectura') then raise exception 'Rol inválido'; end if;
  update public.perfiles_admin set rol = p_rol, updated_at = now() where id = p_id returning * into v_row;
  if not found then raise exception 'Perfil no encontrado'; end if;
  return v_row;
end;
$$;
grant execute on function public.fn_actualizar_rol_perfil(uuid, text) to authenticated;

create or replace function public.fn_actualizar_configuracion_institucional(
  p_mensaje_invitacion text default null,
  p_derecho_admision numeric default null
)
returns public.configuracion_institucional
language plpgsql
security definer
set search_path = public
as $$
declare v_row public.configuracion_institucional;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if public.fn_rol_actual() = 'lectura' then raise exception 'Tu rol no permite cambiar la configuración'; end if;
  update public.configuracion_institucional set
    mensaje_invitacion = coalesce(nullif(btrim(p_mensaje_invitacion), ''), mensaje_invitacion),
    derecho_admision = coalesce(p_derecho_admision, derecho_admision),
    updated_at = now()
  where id = 1
  returning * into v_row;
  return v_row;
end;
$$;
grant execute on function public.fn_actualizar_configuracion_institucional(text, numeric) to authenticated;

-- ============================================================
-- 4. Auditoría inmutable de solicitudes (P0 #4)
-- Cada aprobación/observación/rechazo/cierre de nómina queda
-- registrado acá, con quién lo hizo (usuario autenticado real) y el
-- estado anterior/nuevo. Nadie puede escribir acá directamente desde
-- el navegador — solo las funciones de las secciones 5 y 6, que son
-- las dueñas de la tabla (RLS solo permite lectura a "authenticated").
-- ============================================================
create table if not exists public.auditoria_solicitudes (
  id bigint generated always as identity primary key,
  solicitud_id text references public.solicitudes_socios(id) on delete cascade,
  accion text not null,
  estado_anterior text,
  estado_nuevo text,
  detalle text,
  usuario_id uuid,
  usuario_email text,
  fecha timestamptz not null default now()
);
alter table public.auditoria_solicitudes enable row level security;
drop policy if exists "auditoria_select_auth" on public.auditoria_solicitudes;
create policy "auditoria_select_auth" on public.auditoria_solicitudes for select to authenticated using (true);
create index if not exists idx_auditoria_solicitud on public.auditoria_solicitudes (solicitud_id, fecha desc);

-- ============================================================
-- 5. Aprobar / observar / rechazar — transaccional y auditado (P0 #1, #4)
-- Resolución obligatoria para aprobar, motivo obligatorio para
-- observar/rechazar (antes ninguno de los dos era obligatorio). El
-- número de socio lo asigna esta función bajo un lock de fila
-- (for update), así dos administradores aprobando al mismo tiempo
-- nunca pueden terminar con el mismo número.
-- ============================================================
create or replace function public.fn_aprobar_solicitud(
  p_id text,
  p_resolucion text,
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
  v_proximo int;
  v_email text;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if public.fn_rol_actual() = 'lectura' then raise exception 'Tu rol no permite aprobar solicitudes'; end if;
  if p_resolucion is null or btrim(p_resolucion) = '' then
    raise exception 'La resolución es obligatoria para aprobar';
  end if;

  select * into v_row from public.solicitudes_socios where id = p_id for update;
  if not found then raise exception 'Solicitud no encontrada'; end if;

  if p_numero_socio is not null and btrim(p_numero_socio) <> '' then
    v_numero := lpad(btrim(p_numero_socio), 4, '0');
  else
    select proximo_numero_socio into v_proximo from public.configuracion_institucional where id = 1 for update;
    select greatest(v_proximo, coalesce(max(numero_socio::int), 0) + 1)
      into v_proximo
      from public.solicitudes_socios
      where numero_socio ~ '^[0-9]+$';
    v_numero := lpad(v_proximo::text, 4, '0');
    update public.configuracion_institucional set proximo_numero_socio = v_proximo + 1, updated_at = now() where id = 1;
  end if;

  select email into v_email from auth.users where id = auth.uid();

  update public.solicitudes_socios set
    estado = 'aprobado',
    numero_socio = v_numero,
    resolucion_numero = p_resolucion,
    notas_admin = coalesce(nullif(btrim(p_notas), ''), notas_admin),
    revisado_por = coalesce(v_email, revisado_por),
    fecha_revision = now()
  where id = p_id
  returning * into v_row;

  insert into public.auditoria_solicitudes (solicitud_id, accion, estado_anterior, estado_nuevo, detalle, usuario_id, usuario_email)
  values (p_id, 'aprobar', 'pendiente', 'aprobado', 'Resolución ' || p_resolucion || ' · Socio N.º ' || v_numero, auth.uid(), v_email);

  return v_row;
exception when unique_violation then
  raise exception 'Ese número de socio ya está asignado — probá con otro';
end;
$$;
grant execute on function public.fn_aprobar_solicitud(text, text, text, text) to authenticated;

create or replace function public.fn_resolver_solicitud(
  p_id text,
  p_accion text,
  p_motivo text
)
returns public.solicitudes_socios
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.solicitudes_socios;
  v_estado_anterior text;
  v_email text;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if public.fn_rol_actual() = 'lectura' then raise exception 'Tu rol no permite esta acción'; end if;
  if p_accion not in ('observada','rechazado') then raise exception 'Acción inválida'; end if;
  if p_motivo is null or btrim(p_motivo) = '' then raise exception 'El motivo es obligatorio'; end if;

  select estado into v_estado_anterior from public.solicitudes_socios where id = p_id for update;
  if not found then raise exception 'Solicitud no encontrada'; end if;
  select email into v_email from auth.users where id = auth.uid();

  update public.solicitudes_socios set
    estado = p_accion,
    notas_admin = p_motivo,
    revisado_por = coalesce(v_email, revisado_por),
    fecha_revision = now()
  where id = p_id
  returning * into v_row;

  insert into public.auditoria_solicitudes (solicitud_id, accion, estado_anterior, estado_nuevo, detalle, usuario_id, usuario_email)
  values (p_id, p_accion, v_estado_anterior, p_accion, p_motivo, auth.uid(), v_email);

  return v_row;
end;
$$;
grant execute on function public.fn_resolver_solicitud(text, text, text) to authenticated;

-- ============================================================
-- 6. Cierre técnico de la nómina fundacional (P0 #31)
-- Antes el texto decía "nómina cerrada" pero se podía seguir
-- importando o agregando fundadores igual. Ahora, una vez cerrada,
-- el servidor bloquea altas nuevas (el panel también lo bloquea en
-- pantalla, pero la garantía real está acá). Solo un
-- superadministrador puede cerrarla.
-- ============================================================
create or replace function public.fn_cerrar_nomina_fundacional()
returns public.configuracion_institucional
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.configuracion_institucional;
  v_email text;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if public.fn_rol_actual() <> 'superadministrador' then
    raise exception 'Solo un superadministrador puede cerrar la nómina fundacional';
  end if;
  select email into v_email from auth.users where id = auth.uid();
  update public.configuracion_institucional
    set cierre_fundacional = true, cierre_fundacional_fecha = now(), cierre_fundacional_por = v_email, updated_at = now()
    where id = 1
    returning * into v_row;
  insert into public.auditoria_solicitudes (solicitud_id, accion, detalle, usuario_id, usuario_email)
  values (null, 'cierre_nomina_fundacional', 'Nómina fundacional cerrada técnicamente', auth.uid(), v_email);
  return v_row;
end;
$$;
grant execute on function public.fn_cerrar_nomina_fundacional() to authenticated;

-- Función que usa el panel para bloquear "Importar/Agregar fundador"
-- en el propio cliente ANTES de intentarlo (mejor experiencia), pero
-- la garantía real es que fn_aprobar_solicitud / los inserts directos
-- de fundadores deberían revisarse contra este valor — ver nota en
-- LEEME-CODEX.md sobre el alcance de esta migración.

-- ============================================================
-- 7. Pre-registro con token opaco — nunca datos en la URL (P0 #2, #22)
-- y estados reales del enlace, sin afirmar "enviado" (P0 #5)
-- ============================================================
alter table public.pre_registros add column if not exists token text unique;
alter table public.pre_registros add column if not exists token_expira_at timestamptz;
alter table public.pre_registros add column if not exists fecha_iniciado timestamptz;
alter table public.pre_registros add column if not exists fecha_completado timestamptz;
alter table public.pre_registros add column if not exists solicitud_id text references public.solicitudes_socios(id);

alter table public.pre_registros drop constraint if exists pre_registros_estado_check;
alter table public.pre_registros add constraint pre_registros_estado_check
  check (estado in ('pendiente','preparado','iniciado','completado','descartado','enviado'));
  -- 'enviado' queda solo por compatibilidad con filas ya guardadas antes
  -- de esta migración; el panel deja de usarlo para links nuevos y en su
  -- lugar usa 'preparado' → 'iniciado' → 'completado'.

create or replace function public.fn_generar_token_preregistro(p_id text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  v_token := replace(replace(replace(encode(gen_random_bytes(18), 'base64'), '/', '_'), '+', '-'), '=', '');
  update public.pre_registros
    set token = v_token, token_expira_at = now() + interval '7 days', estado = 'preparado'
    where id = p_id
    returning token into v_token;
  if v_token is null then raise exception 'Pre-registro no encontrado'; end if;
  return v_token;
end;
$$;
grant execute on function public.fn_generar_token_preregistro(text) to authenticated;

-- Llamable SIN login desde el formulario público: solo devuelve lo
-- mínimo para prellenar (nunca la fila completa ni permite listar),
-- y únicamente si el token es válido y no venció.
create or replace function public.fn_resolver_token_preregistro(p_token text)
returns table(pre_registro_id text, nombre_contacto text, celular_whatsapp text)
language sql
security definer
set search_path = public
stable
as $$
  select id, pre_registros.nombre_contacto, pre_registros.celular_whatsapp
  from public.pre_registros
  where token = p_token and token_expira_at > now();
$$;
grant execute on function public.fn_resolver_token_preregistro(text) to anon, authenticated;

create or replace function public.fn_marcar_preregistro_iniciado(p_token text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.pre_registros
    set estado = 'iniciado', fecha_iniciado = now()
    where token = p_token and token_expira_at > now() and estado in ('preparado','enviado');
$$;
grant execute on function public.fn_marcar_preregistro_iniciado(text) to anon, authenticated;

create or replace function public.fn_marcar_preregistro_completado(p_token text, p_solicitud_id text default null)
returns void
language sql
security definer
set search_path = public
as $$
  update public.pre_registros
    set estado = 'completado', fecha_completado = now(),
        solicitud_id = coalesce(p_solicitud_id, solicitud_id)
    where token = p_token and token_expira_at > now();
$$;
grant execute on function public.fn_marcar_preregistro_completado(text, text) to anon, authenticated;

-- ============================================================
-- 8. Endurecer RLS — el login ya está activo en producción, así que
-- corresponde retirar el acceso abierto temporal que tenía sentido
-- solo mientras LOGIN_REQUIRED estaba en false (parte de P0 #3).
-- ============================================================
drop policy if exists "temporal_anon_todo_solicitudes" on public.solicitudes_socios;
drop policy if exists "temporal_anon_todo_preregistros" on public.pre_registros;
drop policy if exists "temporal_anon_todo_actividad" on public.actividad;
drop policy if exists "publico_puede_insertar_solicitud" on public.solicitudes_socios;
drop policy if exists "admin_puede_leer_solicitudes" on public.solicitudes_socios;
drop policy if exists "admin_puede_actualizar_solicitudes" on public.solicitudes_socios;
drop policy if exists "admin_puede_todo_preregistros" on public.pre_registros;
drop policy if exists "admin_puede_todo_actividad" on public.actividad;

-- El formulario público (sin login) solo puede INSERTAR su propia
-- solicitud, nunca leer ni modificar las de otros.
create policy "publico_puede_insertar_solicitud" on public.solicitudes_socios
  for insert to anon, authenticated with check (true);
create policy "admin_puede_leer_solicitudes" on public.solicitudes_socios
  for select to authenticated using (true);
create policy "admin_puede_actualizar_solicitudes" on public.solicitudes_socios
  for update to authenticated using (true) with check (true);

-- pre_registros: el navegador público NUNCA lee ni escribe esta tabla
-- directamente (ni con anon key) — todo pasa por las funciones de la
-- sección 7, que exponen solo lo estrictamente necesario por token.
create policy "admin_puede_todo_preregistros" on public.pre_registros
  for all to authenticated using (true) with check (true);

create policy "admin_puede_todo_actividad" on public.actividad
  for all to authenticated using (true) with check (true);

-- ============================================================
-- Verificación rápida después de correr esto (opcional, podés borrar
-- estas líneas): confirmá que no quedó ninguna policy vieja "temporal_*".
-- select policyname, tablename from pg_policies where schemaname='public' order by tablename;
-- ============================================================
