-- Cooperativa Cimientos — P4 borrado real y limpieza integral
begin;

create or replace function public.fn_eliminar_movimiento_aporte(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_row public.movimientos_aportes%rowtype;
begin
  if auth.uid() is null then raise exception 'Autenticación requerida'; end if;
  if public.fn_rol_actual() not in ('superadministrador','tesoreria') then
    raise exception 'Solo Tesorería o un superadministrador pueden eliminar pagos';
  end if;
  select * into v_row from public.movimientos_aportes where id = p_id for update;
  if not found then raise exception 'El pago ya no existe'; end if;
  if v_row.concepto = 'capital_inicial' and v_row.estado <> 'anulada' then
    update public.solicitudes_socios
      set capital_integrado = greatest(0, coalesce(capital_integrado,0) - v_row.aporte)
      where id = v_row.socio_id;
  end if;
  delete from public.movimientos_aportes where id = p_id;
  return true;
end; $$;
revoke all on function public.fn_eliminar_movimiento_aporte(uuid) from public, anon;
grant execute on function public.fn_eliminar_movimiento_aporte(uuid) to authenticated;

create or replace function public.fn_borrar_datos_operativos()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_result jsonb;
begin
  if auth.uid() is null or public.fn_rol_actual() <> 'superadministrador' then
    raise exception 'Solo un superadministrador puede borrar todos los datos';
  end if;
  v_result := jsonb_build_object(
    'solicitudes', (select count(*) from public.solicitudes_socios),
    'preregistros', (select count(*) from public.pre_registros),
    'actividad', (select count(*) from public.actividad),
    'pagos', (select count(*) from public.movimientos_aportes)
  );
  delete from public.movimientos_aportes;
  delete from storage.objects where bucket_id = 'expedientes';
  delete from public.documentos_socios;
  delete from public.tareas_operativas;
  delete from public.resoluciones_consejo;
  delete from public.campanias;
  delete from public.pre_registros;
  delete from public.solicitudes_socios;
  delete from public.actividad;
  delete from public.auditoria_operativa;
  delete from public.auditoria_solicitudes;
  delete from public.contadores_resoluciones;
  perform setval('public.recibos_numero_seq', 1, false);
  return v_result;
end; $$;
revoke all on function public.fn_borrar_datos_operativos() from public, anon;
grant execute on function public.fn_borrar_datos_operativos() to authenticated;

commit;
