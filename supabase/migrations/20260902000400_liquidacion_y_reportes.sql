begin;
create or replace function private.integrar_capital_inicial() returns trigger
language plpgsql security definer set search_path='' as $$
declare s public.solicitudes_socios%rowtype;
begin
 if new.concepto='capital_inicial' and new.estado='vigente' then
   select * into s from public.solicitudes_socios where id=new.socio_id for update;
   if s.tipo_socio<>'fundador' then raise exception 'Este concepto corresponde al capital fundacional'; end if;
   if coalesce(s.capital_integrado,0)+new.aporte>coalesce(s.capital_suscrito,3000000) then raise exception 'El pago supera el saldo del capital suscrito'; end if;
   update public.solicitudes_socios set capital_integrado=coalesce(capital_integrado,0)+new.aporte where id=s.id;
 end if;
 return new;
end $$;
revoke all on function private.integrar_capital_inicial() from public,anon,authenticated;
create trigger integrar_capital_inicial before insert on public.movimientos_aportes for each row execute function private.integrar_capital_inicial();
create or replace function private.proteger_contador_socios() returns trigger
language plpgsql set search_path='' as $$
begin
 if new.proximo_numero_socio<old.proximo_numero_socio then raise exception 'El contador histórico de socios no puede retroceder'; end if;
 return new;
end $$;
revoke all on function private.proteger_contador_socios() from public,anon,authenticated;
create trigger proteger_contador_socios before update on public.configuracion_institucional for each row execute function private.proteger_contador_socios();
alter table public.liquidaciones_socios add column comprobante_reintegro uuid references public.documentos_socios(id);
create or replace function public.fn_guardar_liquidacion(p_datos jsonb) returns public.liquidaciones_socios
language plpgsql security definer set search_path='' as $$
declare l public.liquidaciones_socios%rowtype; t public.tramites_baja%rowtype; s public.solicitudes_socios%rowtype; next_state text;
begin
 if auth.uid() is null or coalesce(public.fn_rol_actual(),'') not in ('superadministrador','consejo','tesoreria') then raise exception 'Sin permisos para liquidaciones'; end if;
 select * into t from public.tramites_baja where id=(p_datos->>'tramite_id')::uuid for update;
 if not found or t.etapa<>'firme' then raise exception 'Primero debe estar firme la baja'; end if;
 select * into s from public.solicitudes_socios where id=t.socio_id for update;
 select * into l from public.liquidaciones_socios where tramite_id=t.id for update;
 if not found then
   insert into public.liquidaciones_socios(socio_id,tramite_id,tipo_cese,fecha_cese,capital_integrado,creado_por)
   values(s.id,t.id,t.tipo_baja,t.fecha_efectiva,
     case when s.tipo_socio='fundador' then coalesce(s.capital_integrado,0) else 0 end +
     coalesce((select sum(aporte) from public.movimientos_aportes where socio_id=s.id and estado='vigente' and (s.tipo_socio<>'fundador' or concepto<>'capital_inicial')),0),auth.uid()) returning * into l;
 end if;
 next_state:=coalesce(nullif(p_datos->>'estado',''),l.estado);
 if l.estado='cerrada' then raise exception 'La liquidación está cerrada'; end if;
 if next_state='aprobada' and (l.estado<>'pendiente' or public.fn_rol_actual() not in ('superadministrador','consejo')) then raise exception 'La aprobación corresponde al Consejo'; end if;
 if next_state='en_reintegro' and l.estado<>'aprobada' then raise exception 'Debe aprobarse la liquidación primero'; end if;
 if next_state='cerrada' then
   if l.estado not in ('aprobada','en_reintegro') then raise exception 'La liquidación no está aprobada'; end if;
   l.comprobante_reintegro:=nullif(p_datos->>'comprobante_reintegro','')::uuid;
   if not exists(select 1 from public.documentos_socios where id=l.comprobante_reintegro and socio_id=s.id and storage_path is not null) then raise exception 'Registrá el comprobante de reintegro o cancelación en Documentos'; end if;
   l.fecha_cierre:=(p_datos->>'fecha_cierre')::date;
   if l.fecha_cierre is null or l.fecha_cierre<t.fecha_efectiva or l.fecha_cierre>current_date then raise exception 'Fecha de cierre inválida'; end if;
 elsif next_state not in ('pendiente','aprobada','en_reintegro') or (next_state='pendiente' and l.estado<>'pendiente') then raise exception 'Transición no permitida'; end if;
 if coalesce(length(trim(p_datos->>'observaciones')),0)<5 then raise exception 'Documentá el cálculo o la actuación'; end if;
 update public.liquidaciones_socios set
 intereses_pendientes=case when l.estado='pendiente' then coalesce((p_datos->>'intereses_pendientes')::numeric,0) else l.intereses_pendientes end,
 retornos_pendientes=case when l.estado='pendiente' then coalesce((p_datos->>'retornos_pendientes')::numeric,0) else l.retornos_pendientes end,
 otras_acreditaciones=case when l.estado='pendiente' then coalesce((p_datos->>'otras_acreditaciones')::numeric,0) else l.otras_acreditaciones end,
 obligaciones_pendientes=case when l.estado='pendiente' then coalesce((p_datos->>'obligaciones_pendientes')::numeric,0) else l.obligaciones_pendientes end,
 perdidas_imputables=case when l.estado='pendiente' then coalesce((p_datos->>'perdidas_imputables')::numeric,0) else l.perdidas_imputables end,
 forma_reintegro=coalesce(p_datos->>'forma_reintegro',l.forma_reintegro),cantidad_cuotas=coalesce((p_datos->>'cantidad_cuotas')::int,l.cantidad_cuotas),
 estado=next_state,observaciones=trim(p_datos->>'observaciones'),fecha_cierre=l.fecha_cierre,comprobante_reintegro=l.comprobante_reintegro where id=l.id returning * into l;
 update public.tramites_baja set estado_liquidacion=l.estado,etapa=case when l.estado='cerrada' then 'cerrado' else etapa end,updated_at=now() where id=t.id;
 return l;
end $$;
revoke all on function public.fn_guardar_liquidacion(jsonb) from public,anon;
grant execute on function public.fn_guardar_liquidacion(jsonb) to authenticated;

-- Solo los procedimientos controlados pueden cambiar la calidad societaria.
create or replace function private.proteger_estado_societario() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if current_user in ('anon','authenticated') and
 (new.estado_societario is distinct from old.estado_societario or new.fecha_perdida_calidad is distinct from old.fecha_perdida_calidad or new.fecha_ingreso is distinct from old.fecha_ingreso or new.resolucion_baja_id is distinct from old.resolucion_baja_id) then
 raise exception 'Gestioná el estado mediante el trámite societario'; end if;
 return new;
end $$;
revoke all on function private.proteger_estado_societario() from public,anon,authenticated;
create trigger proteger_estado_societario before update on public.solicitudes_socios for each row execute function private.proteger_estado_societario();

create or replace function public.fn_reporte_societario(p_fecha date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or public.fn_rol_actual() is null then raise exception 'Sin permisos'; end if;
 if p_fecha is null or p_fecha>current_date then raise exception 'Fecha de corte inválida'; end if;
 select jsonb_build_object('fecha_corte',p_fecha,'sin_fecha_confirmada',count(*) filter(where fecha_ingreso is null),
 'socios',coalesce(jsonb_agg(jsonb_build_object('id',id,'numero_socio',numero_socio,'nombre',apellidos_nombres,'cedula',cedula,'tipo',tipo_socio,
 'fecha_ingreso',fecha_ingreso,'fecha_baja',fecha_perdida_calidad,'causa_baja',causa_perdida_calidad,
 'calidad_vigente_al_corte',fecha_ingreso<=p_fecha and (fecha_perdida_calidad is null or fecha_perdida_calidad>p_fecha),
 'estado_actual',estado_societario) order by numero_socio::bigint) filter(where fecha_ingreso<=p_fecha),'[]'::jsonb)) into result
 from public.solicitudes_socios where estado='aprobado';
 return result;
end $$;
revoke all on function public.fn_reporte_societario(date) from public,anon;
grant execute on function public.fn_reporte_societario(date) to authenticated;
commit;
