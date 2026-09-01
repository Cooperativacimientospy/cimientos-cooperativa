-- Cooperativa Cimientos — P5 corrección de limpieza integral
-- Los archivos se eliminan desde la API oficial de Storage antes de invocar
-- esta función. Supabase bloquea el DELETE directo sobre storage.objects.
begin;

drop policy if exists expedientes_delete_superadmin on storage.objects;
create policy expedientes_delete_superadmin
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'expedientes'
  and public.fn_rol_actual() = 'superadministrador'
);

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
