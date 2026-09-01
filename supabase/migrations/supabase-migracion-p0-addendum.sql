-- ============================================================
-- COOPERATIVA CIMIENTOS — ADDENDUM A LA MIGRACIÓN P0 (31/08/2026)
-- Cubre los puntos del informe consolidado de Codex que NO estaban
-- ya resueltos por supabase-migracion-p0.sql:
--   - Revocar un token de pre-registro (nuevo estado "revocado")
--   - Proteger al último superadministrador (no se puede degradar
--     ni él mismo ni otra persona si es el único que queda)
--   - "Corregir secuencia" de numeración de socios, como acción
--     separada y auditada (no confundir con fn_aprobar_solicitud)
--   - Cierre de la nómina fundacional con referencia de acta
--     obligatoria
--
-- REQUISITO: correr primero supabase-migracion-p0.sql (este archivo
-- asume que perfiles_admin, configuracion_institucional,
-- auditoria_solicitudes, pre_registros.token/token_expira_at y
-- fn_rol_actual() ya existen).
--
-- ES ADITIVA: usa "if not exists" / "or replace", se puede correr
-- más de una vez sin romper nada. Supabase > SQL Editor > New query > Run.
-- ============================================================

-- ============================================================
-- 1. Estados nuevos del ciclo de vida del link de pre-registro
-- (preparado -> copiado -> enviado -> completado, con vencido y
-- revocado como salidas). "Vencido" el panel lo calcula al vuelo
-- comparando token_expira_at con la hora actual, pero igual hace
-- falta permitirlo acá por si un administrador lo selecciona a mano
-- desde el desplegable de estado.
-- ============================================================
alter table public.pre_registros drop constraint if exists pre_registros_estado_check;
alter table public.pre_registros add constraint pre_registros_estado_check
  check (estado in ('pendiente','preparado','copiado','enviado','iniciado','completado','vencido','revocado','descartado'));

-- fn_marcar_preregistro_iniciado (sección 7 de la migración base) solo
-- aceptaba pasar a "iniciado" desde 'preparado' o 'enviado'; con el
-- estado nuevo "copiado" (link copiado a mano, sin pasar por el botón
-- de WhatsApp) hacía falta agregarlo, si no la persona podía abrir el
-- formulario con un link válido y el estado se quedaba pisado en
-- "copiado" para siempre.
create or replace function public.fn_marcar_preregistro_iniciado(p_token text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.pre_registros
    set estado = 'iniciado', fecha_iniciado = now()
    where token = p_token and token_expira_at > now() and estado in ('preparado','copiado','enviado');
$$;
grant execute on function public.fn_marcar_preregistro_iniciado(text) to anon, authenticated;

-- Revoca el token de un pre-registro: ya no sirve para completar el
-- formulario aunque no haya vencido. Solo quien puede gestionar
-- pre-registros (no "lectura") puede hacerlo.
create or replace function public.fn_revocar_token_preregistro(p_id text)
returns public.pre_registros
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.pre_registros;
  v_email text;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if public.fn_rol_actual() = 'lectura' then raise exception 'Tu rol no permite revocar links'; end if;

  select * into v_row from public.pre_registros where id = p_id for update;
  if not found then raise exception 'Pre-registro no encontrado'; end if;

  update public.pre_registros
    set estado = 'revocado', token = null, token_expira_at = null
    where id = p_id
    returning * into v_row;

  select email into v_email from auth.users where id = auth.uid();
  insert into public.auditoria_solicitudes (solicitud_id, accion, detalle, usuario_id, usuario_email)
  values (null, 'revocar_token_preregistro', 'Pre-registro ' || p_id || ' (' || coalesce(v_row.nombre_contacto, 'sin nombre') || ')', auth.uid(), v_email);

  return v_row;
end;
$$;
grant execute on function public.fn_revocar_token_preregistro(text) to authenticated;

-- ============================================================
-- 2. Proteger al último superadministrador
-- fn_actualizar_rol_perfil ya exigía ser superadministrador para
-- cambiar cualquier rol; ahora además rechaza dejar la cooperativa
-- sin ningún superadministrador (ni degradándose a sí mismo por otra
-- vía que no sea el propio panel, ni degradando al último que queda).
-- ============================================================
create or replace function public.fn_actualizar_rol_perfil(p_id uuid, p_rol text)
returns public.perfiles_admin
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.perfiles_admin;
  v_rol_actual text;
  v_superadmins_restantes int;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if public.fn_rol_actual() <> 'superadministrador' then
    raise exception 'Solo un superadministrador puede cambiar roles';
  end if;
  if p_rol not in ('superadministrador','admision','lectura') then raise exception 'Rol inválido'; end if;

  select rol into v_rol_actual from public.perfiles_admin where id = p_id;
  if v_rol_actual is null then raise exception 'Perfil no encontrado'; end if;

  if v_rol_actual = 'superadministrador' and p_rol <> 'superadministrador' then
    select count(*) into v_superadmins_restantes
      from public.perfiles_admin where rol = 'superadministrador' and id <> p_id;
    if v_superadmins_restantes = 0 then
      raise exception 'No se puede quitar el rol de superadministrador: tiene que quedar al menos uno';
    end if;
  end if;

  update public.perfiles_admin set rol = p_rol, updated_at = now() where id = p_id returning * into v_row;
  return v_row;
end;
$$;
grant execute on function public.fn_actualizar_rol_perfil(uuid, text) to authenticated;

-- ============================================================
-- 3. "Corregir secuencia" — acción explícita de superadministrador,
-- separada de fn_aprobar_solicitud (que asigna el número automático
-- al aprobar). Esta es solo para corregir el contador si quedó mal
-- (ej. después de importar fundadores fuera del flujo normal).
-- Exige motivo y confirmación (la confirmación la hace el panel antes
-- de llamar); queda auditada igual que una aprobación o un cierre de
-- nómina.
-- ============================================================
create or replace function public.fn_corregir_secuencia_socios(p_proximo_numero int, p_motivo text)
returns public.configuracion_institucional
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.configuracion_institucional;
  v_email text;
  v_anterior int;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if public.fn_rol_actual() <> 'superadministrador' then
    raise exception 'Solo un superadministrador puede corregir la numeración de socios';
  end if;
  if p_proximo_numero is null or p_proximo_numero < 1 then
    raise exception 'El próximo número de socio debe ser mayor a 0';
  end if;
  if p_motivo is null or btrim(p_motivo) = '' then
    raise exception 'El motivo es obligatorio para corregir la secuencia';
  end if;

  select proximo_numero_socio into v_anterior from public.configuracion_institucional where id = 1 for update;

  update public.configuracion_institucional
    set proximo_numero_socio = p_proximo_numero, updated_at = now()
    where id = 1
    returning * into v_row;

  select email into v_email from auth.users where id = auth.uid();
  insert into public.auditoria_solicitudes (solicitud_id, accion, detalle, usuario_id, usuario_email)
  values (null, 'corregir_secuencia_socios',
    'Próximo N.º de socio: ' || coalesce(v_anterior::text, '—') || ' -> ' || p_proximo_numero || ' · Motivo: ' || btrim(p_motivo),
    auth.uid(), v_email);

  return v_row;
end;
$$;
grant execute on function public.fn_corregir_secuencia_socios(int, text) to authenticated;

-- ============================================================
-- 4. Cierre de la nómina fundacional con referencia de acta
-- obligatoria (antes se podía cerrar sin dejar constancia de en qué
-- acta del Consejo se resolvió el cierre).
-- ============================================================
alter table public.configuracion_institucional add column if not exists cierre_fundacional_referencia_acta text;

-- Postgres trata una función con distinta firma (distintos
-- parámetros) como una función NUEVA, no como un reemplazo — si no
-- se borra la versión vieja de supabase-migracion-p0.sql (sin
-- parámetros), quedarían las dos a la vez y PostgREST podría no
-- saber cuál usar.
drop function if exists public.fn_cerrar_nomina_fundacional();

create or replace function public.fn_cerrar_nomina_fundacional(p_referencia_acta text default null)
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
  if p_referencia_acta is null or btrim(p_referencia_acta) = '' then
    raise exception 'El cierre de la nómina requiere la referencia del acta que lo respalda';
  end if;
  select email into v_email from auth.users where id = auth.uid();
  update public.configuracion_institucional
    set cierre_fundacional = true, cierre_fundacional_fecha = now(), cierre_fundacional_por = v_email,
        cierre_fundacional_referencia_acta = btrim(p_referencia_acta), updated_at = now()
    where id = 1
    returning * into v_row;
  insert into public.auditoria_solicitudes (solicitud_id, accion, detalle, usuario_id, usuario_email)
  values (null, 'cierre_nomina_fundacional', 'Nómina fundacional cerrada técnicamente · ' || btrim(p_referencia_acta), auth.uid(), v_email);
  return v_row;
end;
$$;
grant execute on function public.fn_cerrar_nomina_fundacional(text) to authenticated;

-- ============================================================
-- Verificación rápida después de correr esto (opcional):
-- select proname from pg_proc where proname in
--   ('fn_revocar_token_preregistro','fn_actualizar_rol_perfil',
--    'fn_corregir_secuencia_socios','fn_cerrar_nomina_fundacional');
-- ============================================================
