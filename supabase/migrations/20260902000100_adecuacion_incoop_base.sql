-- Adecuación v1, parte 1. Aditiva: no borra registros ni reinicia secuencias.
begin;
create or replace function public.fn_rol_actual() returns text
language sql stable security definer set search_path='' as $$
 select rol from public.perfiles_admin where id=auth.uid() and activo=true;
$$;

alter table public.solicitudes_socios
  add column if not exists estado_societario text,
  add column if not exists fecha_ingreso date,
  add column if not exists fecha_solicitud_baja date,
  add column if not exists fecha_perdida_calidad date,
  add column if not exists causa_perdida_calidad text,
  add column if not exists resolucion_baja_id uuid references public.resoluciones_consejo(id),
  add column if not exists observaciones_baja text,
  add column if not exists membresia_anterior_id text references public.solicitudes_socios(id),
  add column if not exists lugar_nacimiento text,
  add column if not exists ingreso_mensual numeric(14,0);

-- Fecha histórica: fundación para fundadores; revisión para ordinarios.
-- La fecha de carga se conserva separadamente en created_at.
update public.solicitudes_socios set estado_societario='activo',
  fecha_ingreso=coalesce(fecha_ingreso,case when tipo_socio='fundador' then fecha_constitucion end,
    (fecha_revision at time zone 'America/Asuncion')::date)
where estado='aprobado' and estado_societario is null;
alter table public.solicitudes_socios add constraint estado_societario_valido check
  (estado_societario is null or estado_societario in ('activo','suspendido','renuncia_en_tramite','baja_voluntaria','excluido','expulsado','fallecido'));
alter table public.solicitudes_socios add constraint ingreso_mensual_valido check (ingreso_mensual is null or ingreso_mensual>=0);
create index if not exists socios_estado_fecha_idx on public.solicitudes_socios(estado_societario,fecha_ingreso,fecha_perdida_calidad);

-- Reserva histórica independiente de la existencia/estado de una solicitud.
create table if not exists public.matriculas_historicas (
  numero bigint primary key check(numero>0), solicitud_id text not null unique,
  asignado_at timestamptz not null default now()
);
alter table public.matriculas_historicas enable row level security;
revoke all on public.matriculas_historicas from public,anon,authenticated;
insert into public.matriculas_historicas(numero,solicitud_id)
select numero_socio::bigint,id from public.solicitudes_socios where numero_socio ~ '^[0-9]+$'
on conflict (solicitud_id) do nothing;
create sequence if not exists public.socios_matricula_seq as bigint;
select setval('public.socios_matricula_seq',greatest(
 (select last_value+case when is_called then 1 else 0 end from public.socios_matricula_seq),
 coalesce((select max(numero)+1 from public.matriculas_historicas),1),
 coalesce((select proximo_numero_socio from public.configuracion_institucional where id=1),1)),false);
revoke all on sequence public.socios_matricula_seq from public,anon,authenticated;

create or replace function private.proteger_matricula() returns trigger
language plpgsql security definer set search_path='' as $$
declare n bigint;
begin
 if TG_OP='DELETE' then
   if old.numero_socio is not null or old.estado='aprobado' then raise exception 'La matrícula es histórica: registrá una baja, no una eliminación'; end if;
   return old;
 end if;
 if TG_OP='UPDATE' and old.numero_socio is not null and
   (new.numero_socio is distinct from old.numero_socio or new.estado<>'aprobado') then
   raise exception 'No se puede cambiar ni liberar una matrícula histórica';
 end if;
 if new.estado='aprobado' and (TG_OP='INSERT' or old.numero_socio is null) then
   perform pg_advisory_xact_lock(7312026);
   if new.tipo_socio='fundador' and new.numero_socio is not null then
     n:=new.numero_socio::bigint;
   else
     n:=nextval('public.socios_matricula_seq');
     while exists(select 1 from public.matriculas_historicas where numero=n) loop n:=nextval('public.socios_matricula_seq'); end loop;
   end if;
   insert into public.matriculas_historicas(numero,solicitud_id) values(n,new.id);
   new.numero_socio:=case when n<10000 then lpad(n::text,4,'0') else n::text end;
   new.estado_societario:='activo';
   new.fecha_ingreso:=coalesce(new.fecha_ingreso,case when new.tipo_socio='fundador' then new.fecha_constitucion end,current_date);
   if new.tipo_socio='fundador' then
     perform setval('public.socios_matricula_seq',greatest(n+1,(select last_value+case when is_called then 1 else 0 end from public.socios_matricula_seq)),false);
   end if;
   update public.configuracion_institucional set proximo_numero_socio=greatest(proximo_numero_socio,n+1) where id=1;
 end if;
 return new;
end $$;
revoke all on function private.proteger_matricula() from public,anon,authenticated;
create trigger proteger_matricula before insert or update or delete on public.solicitudes_socios for each row execute function private.proteger_matricula();

-- Producción nunca dispone de un borrado total.
create or replace function public.fn_borrar_datos_operativos() returns jsonb
language plpgsql security invoker set search_path='' as $$
begin raise exception 'Borrado total deshabilitado en producción. El historial debe conservarse'; end $$;
revoke all on function public.fn_borrar_datos_operativos() from public,anon,authenticated;
create or replace function public.fn_eliminar_movimiento_aporte(p_id uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
begin raise exception 'Los pagos no se eliminan. Utilizá Anular con un motivo'; end $$;
revoke all on function public.fn_eliminar_movimiento_aporte(uuid) from public,anon,authenticated;
revoke delete on public.movimientos_aportes from authenticated,anon;
alter table public.movimientos_aportes add column if not exists motivo_anulacion text,
 add column if not exists anulado_por uuid, add column if not exists anulado_at timestamptz;

create or replace function public.fn_anular_aportes(p_ids uuid[],p_motivo text) returns integer
language plpgsql security definer set search_path='' as $$
declare r public.movimientos_aportes%rowtype; total integer:=0;
begin
 if auth.uid() is null or coalesce(public.fn_rol_actual(),'') not in ('superadministrador','tesoreria') then raise exception 'Sin permisos para anular pagos'; end if;
 if length(trim(p_motivo))<5 or p_motivo is null then raise exception 'Indicá el motivo de la anulación'; end if;
 if coalesce(cardinality(p_ids),0) not between 1 and 500 then raise exception 'Seleccioná entre 1 y 500 pagos'; end if;
 for r in select * from public.movimientos_aportes where id=any(p_ids) order by id for update loop
   if r.estado='anulada' then continue; end if;
   update public.movimientos_aportes set estado='anulada',motivo_anulacion=trim(p_motivo),anulado_por=auth.uid(),anulado_at=now() where id=r.id;
   total:=total+1;
 end loop;
 return total;
end $$;
revoke all on function public.fn_anular_aportes(uuid[],text) from public,anon;
grant execute on function public.fn_anular_aportes(uuid[],text) to authenticated;
create or replace function private.proteger_pago() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'Los pagos se anulan, no se eliminan'; end if;
 if old.estado='anulada' then raise exception 'Un recibo anulado es histórico y no puede modificarse'; end if;
 if (to_jsonb(new)-array['estado','motivo_anulacion','anulado_por','anulado_at','updated_at']) is distinct from
    (to_jsonb(old)-array['estado','motivo_anulacion','anulado_por','anulado_at','updated_at']) then
   raise exception 'Para corregir un pago, anulá el recibo y registrá uno nuevo';
 end if;
 if new.estado<>'anulada' or coalesce(length(trim(new.motivo_anulacion)),0)<5 then raise exception 'La anulación requiere un motivo'; end if;
 if auth.uid() is null or coalesce(public.fn_rol_actual(),'') not in ('superadministrador','tesoreria') then raise exception 'Sin permisos para anular'; end if;
 new.anulado_por:=auth.uid(); new.anulado_at:=now();
 if old.concepto='capital_inicial' then
   update public.solicitudes_socios set capital_integrado=greatest(0,coalesce(capital_integrado,0)-old.aporte) where id=old.socio_id;
 end if;
 return new;
end $$;
revoke all on function private.proteger_pago() from public,anon,authenticated;
create trigger proteger_pago before update or delete on public.movimientos_aportes for each row execute function private.proteger_pago();

-- Listas operativas descartables; sin afectar socios, pagos ni resoluciones.
create or replace function public.fn_eliminar_lote(p_tipo text,p_ids text[],p_motivo text) returns integer
language plpgsql security definer set search_path='' as $$
declare t text; r record; total integer:=0; role_name text:=coalesce(public.fn_rol_actual(),'');
begin
 if auth.uid() is null or role_name not in ('superadministrador','admision','secretaria','atencion','consejo') then raise exception 'Sin permisos para eliminar registros'; end if;
 if coalesce(cardinality(p_ids),0) not between 1 and 500 or coalesce(length(trim(p_motivo)),0)<5 then raise exception 'Seleccioná registros e indicá el motivo'; end if;
 t:=case p_tipo when 'preregistros' then 'pre_registros' when 'solicitudes' then 'solicitudes_socios' when 'tareas' then 'tareas_operativas' when 'campanias' then 'campanias' end;
 if t is null then raise exception 'Esta sección conserva historial y no admite eliminación'; end if;
 if p_tipo='solicitudes' and role_name not in ('superadministrador','admision') then raise exception 'Sin permisos para eliminar solicitudes'; end if;
 if p_tipo='campanias' and role_name not in ('superadministrador','admision','atencion') then raise exception 'Sin permisos para eliminar campañas'; end if;
 if (select count(distinct id) from unnest(p_ids) id)<>cardinality(p_ids) then raise exception 'La selección contiene duplicados'; end if;
 for r in execute format('select * from public.%I where id::text=any($1) order by id for update',t) using p_ids loop
   if p_tipo='solicitudes' and (to_jsonb(r)->>'estado'='aprobado' or to_jsonb(r)->>'numero_socio' is not null) then raise exception 'No se pueden eliminar socios admitidos'; end if;
   if p_tipo='preregistros' and (to_jsonb(r)->>'solicitud_id' is not null or to_jsonb(r)->>'estado' in ('iniciado','completado')) then raise exception 'Un pre-registro seleccionado ya tiene un trámite vinculado'; end if;
   insert into public.auditoria_operativa(tabla,registro_id,accion,usuario_id,valor_anterior,valor_nuevo)
     values(t,to_jsonb(r)->>'id','DELETE',auth.uid(),to_jsonb(r),jsonb_build_object('motivo',trim(p_motivo)));
   execute format('delete from public.%I where id::text=$1',t) using to_jsonb(r)->>'id';
   total:=total+1;
 end loop;
 if total<>cardinality(p_ids) then raise exception 'La selección cambió; recargá la lista. No se eliminó ningún registro'; end if;
 return total;
end $$;
revoke all on function public.fn_eliminar_lote(text,text[],text) from public,anon;
grant execute on function public.fn_eliminar_lote(text,text[],text) to authenticated;

alter table public.configuracion_institucional add column if not exists identidad jsonb not null default '{}'::jsonb;
create or replace function public.fn_identidad_publica() returns jsonb
language sql stable security definer set search_path='' as $$ select identidad from public.configuracion_institucional where id=1 $$;
revoke all on function public.fn_identidad_publica() from public;
grant execute on function public.fn_identidad_publica() to anon,authenticated;
create or replace function public.fn_guardar_identidad(p_identidad jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or coalesce(public.fn_rol_actual(),'')<>'superadministrador' then raise exception 'Solo un superadministrador puede cambiar la identidad'; end if;
 if coalesce(length(trim(p_identidad->>'nombre')),0) not between 3 and 100 then raise exception 'El nombre debe tener entre 3 y 100 caracteres'; end if;
 if length(p_identidad::text)>1500000 then raise exception 'Las imágenes son demasiado grandes'; end if;
 if coalesce(p_identidad->>'logo','') !~ '^(|data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+)$'
 or coalesce(p_identidad->>'favicon','') !~ '^(|data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+)$' then raise exception 'Formato de imagen no permitido'; end if;
 if exists(select 1 from jsonb_each_text(p_identidad) where key in ('green','orange','bg') and value !~ '^#[0-9A-Fa-f]{6}$') then raise exception 'Color inválido'; end if;
 update public.configuracion_institucional set identidad=p_identidad,updated_at=now() where id=1;
 return p_identidad;
end $$;
revoke all on function public.fn_guardar_identidad(jsonb) from public,anon;
grant execute on function public.fn_guardar_identidad(jsonb) to authenticated;

-- Las solicitudes públicas legítimamente no tienen auth.uid().
create or replace function private.auditar_societario() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into public.auditoria_operativa(tabla,registro_id,accion,usuario_id,valor_anterior,valor_nuevo)
 values(tg_table_name,coalesce(new.id::text,old.id::text),tg_op,auth.uid(),
 case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
 case when tg_op in ('UPDATE','INSERT') then to_jsonb(new) end);
 return coalesce(new,old);
end $$;
revoke all on function private.auditar_societario() from public,anon,authenticated;
create trigger auditar_configuracion after update on public.configuracion_institucional for each row execute function private.auditar_societario();
create trigger auditar_socios after insert or update or delete on public.solicitudes_socios for each row execute function private.auditar_societario();
commit;
