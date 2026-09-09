-- Gestión controlada de registros corregibles. Los socios, pagos emitidos y
-- resoluciones no se borran: conservan su historial societario/contable.
begin;

drop policy if exists tareas_delete_admin on public.tareas_operativas;
create policy tareas_delete_admin on public.tareas_operativas
  for delete to authenticated
  using (public.fn_rol_actual() = 'superadministrador');

drop policy if exists documentos_delete_admin on public.documentos_socios;
create policy documentos_delete_admin on public.documentos_socios
  for delete to authenticated
  using (public.fn_rol_actual() = 'superadministrador');

drop policy if exists expedientes_delete_admin on storage.objects;
create policy expedientes_delete_admin on storage.objects
  for delete to authenticated
  using (bucket_id = 'expedientes' and public.fn_rol_actual() = 'superadministrador');

commit;
