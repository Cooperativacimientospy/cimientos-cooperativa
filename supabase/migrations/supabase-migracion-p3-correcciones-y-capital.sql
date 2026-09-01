-- Cooperativa Cimientos — P3 correcciones, anulaciones y capital fundacional
begin;

alter table public.movimientos_aportes add column if not exists concepto text not null default 'aporte_mensual';
alter table public.movimientos_aportes drop constraint if exists movimientos_aportes_concepto_check;
alter table public.movimientos_aportes add constraint movimientos_aportes_concepto_check
  check (concepto in ('aporte_mensual','capital_inicial','solidaridad','otro'));

alter table public.solicitudes_socios add column if not exists capital_suscrito numeric(14,0);
alter table public.solicitudes_socios add column if not exists capital_integrado numeric(14,0);

create or replace function public.fn_eliminar_solicitud(p_id text, p_motivo text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_row public.solicitudes_socios%rowtype;
begin
  if public.fn_rol_actual() not in ('superadministrador','admision') then raise exception 'No tenés permisos para eliminar solicitudes'; end if;
  if nullif(btrim(p_motivo),'') is null then raise exception 'El motivo es obligatorio'; end if;
  select * into v_row from public.solicitudes_socios where id=p_id for update;
  if not found then raise exception 'Solicitud no encontrada'; end if;
  if v_row.estado='aprobado' or v_row.numero_socio is not null then raise exception 'Un socio admitido no se puede eliminar; debe inactivarse mediante resolución'; end if;
  if exists(select 1 from public.movimientos_aportes where socio_id=p_id) then raise exception 'La solicitud tiene movimientos asociados'; end if;
  insert into public.auditoria_operativa(tabla,registro_id,accion,usuario_id,valor_anterior,valor_nuevo)
  values('solicitudes_socios',p_id,'DELETE',auth.uid(),to_jsonb(v_row),jsonb_build_object('motivo',btrim(p_motivo)));
  delete from public.solicitudes_socios where id=p_id;
  return true;
end; $$;
revoke all on function public.fn_eliminar_solicitud(text,text) from public, anon;
grant execute on function public.fn_eliminar_solicitud(text,text) to authenticated;

commit;
