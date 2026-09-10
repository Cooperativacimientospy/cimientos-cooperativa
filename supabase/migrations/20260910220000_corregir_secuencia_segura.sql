begin;

-- El contador no retrocede por ediciones comunes. Una corrección explícita y
-- auditada puede hacerlo únicamente mediante fn_corregir_secuencia_socios.
create or replace function private.proteger_contador_socios() returns trigger
language plpgsql set search_path=''
as $$
begin
  if new.proximo_numero_socio < old.proximo_numero_socio
     and coalesce(current_setting('cimientos.corrigiendo_contador', true), '') <> '1' then
    raise exception 'El contador histórico de socios no puede retroceder';
  end if;
  return new;
end $$;

create or replace function public.fn_corregir_secuencia_socios(p_proximo_numero int, p_motivo text)
returns public.configuracion_institucional
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.configuracion_institucional;
  v_email text;
  v_anterior int;
  v_minimo bigint;
begin
  if (select auth.uid()) is null then raise exception 'No autenticado'; end if;
  if public.fn_rol_actual() <> 'superadministrador' then
    raise exception 'Solo un superadministrador puede corregir la numeración de socios';
  end if;
  if p_proximo_numero is null or p_proximo_numero < 1 then
    raise exception 'El próximo número de socio debe ser mayor a 0';
  end if;
  if p_motivo is null or btrim(p_motivo) = '' then
    raise exception 'El motivo es obligatorio para corregir la secuencia';
  end if;

  select coalesce(max(numero), 0) + 1 into v_minimo
  from public.matriculas_historicas;
  if p_proximo_numero < v_minimo then
    raise exception 'El número % ya fue asignado o está por debajo de una matrícula histórica. El mínimo disponible es %',
      p_proximo_numero, v_minimo;
  end if;

  select proximo_numero_socio into v_anterior
  from public.configuracion_institucional where id = 1 for update;

  perform set_config('cimientos.corrigiendo_contador', '1', true);
  update public.configuracion_institucional
  set proximo_numero_socio = p_proximo_numero, updated_at = now()
  where id = 1
  returning * into v_row;
  perform setval('public.socios_matricula_seq', p_proximo_numero, false);

  select email into v_email from auth.users where id = (select auth.uid());
  insert into public.auditoria_solicitudes
    (solicitud_id, accion, detalle, usuario_id, usuario_email)
  values
    (null, 'corregir_secuencia_socios',
     'Próximo N.º de socio: ' || coalesce(v_anterior::text, '—') || ' -> ' || p_proximo_numero || ' · Motivo: ' || btrim(p_motivo),
     (select auth.uid()), v_email);

  return v_row;
end;

revoke all on function public.fn_corregir_secuencia_socios(int,text) from public, anon;
grant execute on function public.fn_corregir_secuencia_socios(int,text) to authenticated;

commit;
