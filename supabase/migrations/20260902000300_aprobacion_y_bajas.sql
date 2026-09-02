begin;
create or replace function public.fn_aprobar_solicitud(p_id text,p_resolucion text default null,p_numero_socio text default null,p_notas text default null)
returns public.solicitudes_socios language plpgsql security definer set search_path='' as $$
declare r public.solicitudes_socios%rowtype; resol text; email text;
begin
 if auth.uid() is null or coalesce(public.fn_rol_actual(),'') not in ('superadministrador','consejo','admision') then raise exception 'Sin permisos para aprobar'; end if;
 select * into r from public.solicitudes_socios where id=p_id for update;
 if not found or r.estado not in ('pendiente','observada') then raise exception 'La solicitud no está pendiente de aprobación'; end if;
 perform pg_advisory_xact_lock(7312026);
 resol:=coalesce(nullif(trim(p_resolucion),''),public.fn_siguiente_numero_resolucion(extract(year from current_date)::int));
 select u.email into email from auth.users u where u.id=auth.uid();
 insert into public.resoluciones_consejo(numero,fecha,socio_id,decision,detalle,estado,creado_por)
 values(resol,current_date,p_id,'Admisión',coalesce(p_notas,'Admisión resuelta por el Consejo'),'emitida',auth.uid());
 update public.solicitudes_socios set estado='aprobado',numero_socio=null,
   resolucion_numero=resol,notas_admin=coalesce(nullif(trim(p_notas),''),notas_admin),
   revisado_por=email,fecha_revision=now(),fecha_ingreso=current_date
 where id=p_id returning * into r;
 insert into public.auditoria_solicitudes(solicitud_id,accion,estado_nuevo,detalle,usuario_id,usuario_email)
 values(p_id,'aprobar','aprobado','Resolución '||resol||' · Socio N.º '||r.numero_socio,auth.uid(),email);
 return r;
end $$;
revoke all on function public.fn_aprobar_solicitud(text,text,text,text) from public,anon;
grant execute on function public.fn_aprobar_solicitud(text,text,text,text) to authenticated;

create table public.tramites_baja (
 id uuid primary key default gen_random_uuid(), socio_id text not null references public.solicitudes_socios(id),
 tipo_baja text not null check(tipo_baja in ('renuncia','exclusion','expulsion','fallecimiento')),
 etapa text not null default 'iniciado' check(etapa in ('iniciado','notificado','sumario_abierto','sancion_resuelta','reconsideracion','apelacion','firme','regularizado','cerrado')),
 fecha_presentacion date not null, motivo text not null check(length(trim(motivo))>=5),
 documento_solicitud uuid references public.documentos_socios(id),
 fecha_notificacion date, plazo_hasta date, evidencia_notificacion uuid references public.documentos_socios(id),
 resolucion_id uuid references public.resoluciones_consejo(id), fecha_resolucion date, fecha_efectiva date,
 observaciones text, estado_liquidacion text not null default 'pendiente',
 creado_por uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index una_baja_abierta_por_socio on public.tramites_baja(socio_id) where etapa not in ('regularizado','cerrado');
alter table public.tramites_baja enable row level security;
grant select on public.tramites_baja to authenticated;
create policy lectura_bajas on public.tramites_baja for select to authenticated using (public.fn_rol_actual() is not null);
revoke insert,update,delete on public.tramites_baja from anon,authenticated;
create trigger auditar_baja after insert or update or delete on public.tramites_baja for each row execute function private.auditar_societario();

create or replace function public.fn_guardar_tramite_baja(p_datos jsonb) returns public.tramites_baja
language plpgsql security definer set search_path='' as $$
declare t public.tramites_baja%rowtype; s public.solicitudes_socios%rowtype; res public.resoluciones_consejo%rowtype; next_stage text; doc uuid;
begin
 if auth.uid() is null or coalesce(public.fn_rol_actual(),'') not in ('superadministrador','consejo','secretaria') then raise exception 'Solo Consejo, Secretaría o superadministración pueden gestionar bajas'; end if;
 select * into s from public.solicitudes_socios where id=p_datos->>'socio_id' for update;
 if not found or s.estado<>'aprobado' then raise exception 'Socio no encontrado'; end if;
 if nullif(p_datos->>'id','') is null then
   if coalesce(s.estado_societario,'activo') not in ('activo','suspendido') then raise exception 'El socio ya tiene una baja o un trámite en curso'; end if;
   doc:=nullif(p_datos->>'documento_solicitud','')::uuid;
   if doc is null or not exists(select 1 from public.documentos_socios where id=doc and socio_id=s.id and storage_path is not null) then raise exception 'Adjuntá y registrá primero el documento de respaldo en Documentos'; end if;
   if (p_datos->>'fecha_presentacion')::date>current_date then raise exception 'La fecha no puede ser futura'; end if;
   insert into public.tramites_baja(socio_id,tipo_baja,fecha_presentacion,motivo,documento_solicitud,creado_por,etapa)
   values(s.id,p_datos->>'tipo_baja',(p_datos->>'fecha_presentacion')::date,trim(p_datos->>'motivo'),doc,auth.uid(),case when p_datos->>'tipo_baja'='expulsion' then 'sumario_abierto' else 'iniciado' end) returning * into t;
   update public.solicitudes_socios set fecha_solicitud_baja=t.fecha_presentacion,estado_societario=case when t.tipo_baja='renuncia' then 'renuncia_en_tramite' else estado_societario end where id=s.id;
   return t;
 end if;
 select * into t from public.tramites_baja where id=(p_datos->>'id')::uuid and socio_id=s.id for update;
 if not found or t.etapa in ('cerrado','regularizado','firme') then raise exception 'El trámite no admite cambios'; end if;
 next_stage:=p_datos->>'etapa';
 if next_stage='notificado' and t.tipo_baja='exclusion' and t.etapa='iniciado' then
   doc:=nullif(p_datos->>'evidencia_notificacion','')::uuid;
   if doc is null or not exists(select 1 from public.documentos_socios where id=doc and socio_id=s.id and storage_path is not null) then raise exception 'Falta la evidencia de notificación'; end if;
   t.fecha_notificacion:=(p_datos->>'fecha_notificacion')::date;
   if t.fecha_notificacion is null or t.fecha_notificacion<t.fecha_presentacion or t.fecha_notificacion>current_date then raise exception 'Fecha de notificación inválida'; end if;
   t.plazo_hasta:=t.fecha_notificacion+30; t.evidencia_notificacion:=doc;
 elsif next_stage='regularizado' and t.etapa in ('iniciado','notificado') and t.tipo_baja in ('renuncia','exclusion') then
   if coalesce(length(trim(p_datos->>'observaciones')),0)<5 then raise exception 'Indicá el motivo de cierre sin baja'; end if;
   update public.solicitudes_socios set estado_societario=case when estado_societario='renuncia_en_tramite' then 'activo' else estado_societario end where id=s.id;
 elsif t.tipo_baja='expulsion' and ((t.etapa='sumario_abierto' and next_stage='sancion_resuelta') or (t.etapa='sancion_resuelta' and next_stage in ('reconsideracion','apelacion')) or (t.etapa='reconsideracion' and next_stage='apelacion')) then
   if coalesce(length(trim(p_datos->>'observaciones')),0)<5 then raise exception 'Documentá la actuación en las observaciones'; end if;
 elsif next_stage='firme' then
   if public.fn_rol_actual() not in ('superadministrador','consejo') then raise exception 'La decisión final corresponde al Consejo'; end if;
   if t.tipo_baja='exclusion' and (t.etapa<>'notificado' or current_date<t.plazo_hasta) then raise exception 'Debe notificarse y cumplirse el plazo de 30 días'; end if;
   if t.tipo_baja='expulsion' and t.etapa not in ('sancion_resuelta','reconsideracion','apelacion') then raise exception 'Debe tramitarse primero el sumario y la sanción'; end if;
   select * into res from public.resoluciones_consejo where id=nullif(p_datos->>'resolucion_id','')::uuid and estado='emitida' and socio_id=s.id;
   if not found then raise exception 'Seleccioná una resolución emitida para este socio'; end if;
   t.fecha_efectiva:=(p_datos->>'fecha_efectiva')::date;
   if t.fecha_efectiva is null or t.fecha_efectiva>current_date or t.fecha_efectiva<greatest(t.fecha_presentacion,res.fecha,coalesce(t.plazo_hasta,t.fecha_presentacion)) then raise exception 'Fecha efectiva inválida'; end if;
   if coalesce(length(trim(p_datos->>'observaciones')),0)<5 then raise exception 'Documentá la firmeza de la decisión'; end if;
   t.resolucion_id:=res.id; t.fecha_resolucion:=res.fecha;
   update public.solicitudes_socios set estado_societario=case t.tipo_baja when 'renuncia' then 'baja_voluntaria' when 'exclusion' then 'excluido' when 'expulsion' then 'expulsado' else 'fallecido' end,
     fecha_perdida_calidad=t.fecha_efectiva,causa_perdida_calidad=t.motivo,resolucion_baja_id=res.id,observaciones_baja=p_datos->>'observaciones' where id=s.id;
 else raise exception 'Transición de trámite no permitida'; end if;
 update public.tramites_baja set etapa=next_stage,fecha_notificacion=t.fecha_notificacion,plazo_hasta=t.plazo_hasta,evidencia_notificacion=t.evidencia_notificacion,
 resolucion_id=t.resolucion_id,fecha_resolucion=t.fecha_resolucion,fecha_efectiva=t.fecha_efectiva,observaciones=p_datos->>'observaciones',updated_at=now()
 where id=t.id returning * into t;
 return t;
end $$;
revoke all on function public.fn_guardar_tramite_baja(jsonb) from public,anon;
grant execute on function public.fn_guardar_tramite_baja(jsonb) to authenticated;

create table public.liquidaciones_socios (
 id uuid primary key default gen_random_uuid(), socio_id text not null references public.solicitudes_socios(id),
 tramite_id uuid not null unique references public.tramites_baja(id), tipo_cese text not null, fecha_cese date not null,
 capital_integrado numeric(14,0) not null check(capital_integrado>=0), intereses_pendientes numeric(14,0) not null default 0 check(intereses_pendientes>=0),
 retornos_pendientes numeric(14,0) not null default 0 check(retornos_pendientes>=0), otras_acreditaciones numeric(14,0) not null default 0 check(otras_acreditaciones>=0),
 obligaciones_pendientes numeric(14,0) not null default 0 check(obligaciones_pendientes>=0), perdidas_imputables numeric(14,0) not null default 0 check(perdidas_imputables>=0),
 saldo_final numeric(14,0) generated always as (capital_integrado+intereses_pendientes+retornos_pendientes+otras_acreditaciones-obligaciones_pendientes-perdidas_imputables) stored,
 forma_reintegro text, cantidad_cuotas integer not null default 1 check(cantidad_cuotas>0), estado text not null default 'pendiente' check(estado in ('pendiente','aprobada','en_reintegro','cerrada')),
 fecha_cierre date, observaciones text, creado_por uuid references auth.users(id),created_at timestamptz not null default now()
);
alter table public.liquidaciones_socios enable row level security;
grant select on public.liquidaciones_socios to authenticated;
create policy lectura_liquidaciones on public.liquidaciones_socios for select to authenticated using(public.fn_rol_actual() in ('superadministrador','consejo','tesoreria','auditoria'));
revoke insert,update,delete on public.liquidaciones_socios from anon,authenticated;
create trigger auditar_liquidacion after insert or update or delete on public.liquidaciones_socios for each row execute function private.auditar_societario();

-- Infraestructura preparada; la emisión de certificados requiere validación contable.
create sequence public.numero_certificado_seq;
create sequence public.numero_titulo_seq;
revoke all on sequence public.numero_certificado_seq,public.numero_titulo_seq from public,anon,authenticated;
create table public.certificados_aportacion (
 id uuid primary key default gen_random_uuid(),socio_id text not null references public.solicitudes_socios(id),
 numero_certificado bigint not null unique default nextval('public.numero_certificado_seq'),
 numero_titulo bigint not null unique default nextval('public.numero_titulo_seq'),
 valor_nominal numeric(14,0) not null default 30000 check(valor_nominal>0),fecha_integracion date not null,
 estado text not null default 'vigente' check(estado in ('vigente','anulado','reintegrado')),created_at timestamptz not null default now()
);
alter table public.certificados_aportacion enable row level security;
revoke all on public.certificados_aportacion from anon,authenticated;
grant select on public.certificados_aportacion to authenticated;
create policy lectura_certificados on public.certificados_aportacion for select to authenticated using(public.fn_rol_actual() is not null);
commit;
