-- Ejecutar SOLO después de las migraciones dentro de la MISMA transacción
-- de prueba, y finalizar con ROLLBACK. Usa registros sintéticos, no socios reales.
do $test$
declare actor uuid; s public.solicitudes_socios%rowtype; f public.solicitudes_socios%rowtype;
 d uuid; res uuid; t public.tramites_baja%rowtype; l public.liquidaciones_socios%rowtype; pago uuid; n int;
begin
 select id into actor from public.perfiles_admin where rol='superadministrador' and activo=true limit 1;
 if actor is null then raise exception 'Prueba requiere perfil superadministrador existente'; end if;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 insert into public.solicitudes_socios(id,numero_solicitud,tipo_socio,estado,apellidos_nombres,cedula)
 overriding system value values('QA-TRANSACCION-SOCIO',-900001,'ordinario','pendiente','QA sintético — no real','QA900001');
 s:=public.fn_aprobar_solicitud('QA-TRANSACCION-SOCIO','RES-QA-TRANSACCION',null,'Prueba reversible de admisión');
 if s.numero_socio is null or s.estado_societario<>'activo' then raise exception 'Falló asignación de matrícula'; end if;
 begin
   update public.solicitudes_socios set numero_socio='99999999' where id=s.id;
   raise exception 'FALLO: permitió cambiar matrícula';
 exception when others then if SQLERRM like 'FALLO:%' then raise; end if; end;
 insert into public.solicitudes_socios(id,numero_solicitud,tipo_socio,estado,apellidos_nombres,cedula,numero_socio,capital_suscrito,capital_integrado)
 overriding system value values('QA-TRANSACCION-FUNDADOR',-900002,'fundador','aprobado','QA fundador — no real','QA900002','99000001',3000000,1800000) returning * into f;
 insert into public.movimientos_aportes(socio_id,periodo,fecha_pago,aporte,solidaridad,otros,forma_pago,recibo_numero,concepto,creado_por)
 values(f.id,to_char(current_date,'YYYY-MM'),current_date,1200000,0,0,'Transferencia','REC-QA-TRANSACCION','capital_inicial',actor) returning id into pago;
 if (select capital_integrado from public.solicitudes_socios where id=f.id)<>3000000 then raise exception 'Falló integración de capital'; end if;
 perform public.fn_anular_aportes(array[pago],'Prueba reversible de anulación');
 perform public.fn_anular_aportes(array[pago],'Prueba repetida de anulación');
 if (select capital_integrado from public.solicitudes_socios where id=f.id)<>1800000 then raise exception 'La anulación no fue idempotente'; end if;
 begin delete from public.movimientos_aportes where id=pago; raise exception 'FALLO: permitió eliminar pago';
 exception when others then if SQLERRM like 'FALLO:%' then raise; end if; end;
 insert into public.documentos_socios(socio_id,tipo,estado,nombre_archivo,storage_path,creado_por)
 values(s.id,'Solicitud firmada','vigente','QA-sintetico.pdf','QA-SIN-ARCHIVO-REAL',actor) returning id into d;
 t:=public.fn_guardar_tramite_baja(jsonb_build_object('socio_id',s.id,'tipo_baja','renuncia','fecha_presentacion',current_date,'documento_solicitud',d,'motivo','Prueba reversible de renuncia'));
 insert into public.resoluciones_consejo(numero,fecha,socio_id,decision,detalle,estado,creado_por)
 values('RES-QA-BAJA',current_date,s.id,'Renuncia','Prueba reversible de baja','emitida',actor) returning id into res;
 t:=public.fn_guardar_tramite_baja(jsonb_build_object('id',t.id,'socio_id',s.id,'etapa','firme','resolucion_id',res,'fecha_efectiva',current_date,'observaciones','Prueba reversible de firmeza'));
 if (select numero_socio from public.solicitudes_socios where id=s.id)<>s.numero_socio then raise exception 'La baja cambió la matrícula'; end if;
 l:=public.fn_guardar_liquidacion(jsonb_build_object('tramite_id',t.id,'estado','pendiente','observaciones','Prueba reversible de liquidación'));
 l:=public.fn_guardar_liquidacion(jsonb_build_object('tramite_id',t.id,'estado','aprobada','observaciones','Prueba reversible de aprobación'));
 l:=public.fn_guardar_liquidacion(jsonb_build_object('tramite_id',t.id,'estado','cerrada','comprobante_reintegro',d,'fecha_cierre',current_date,'observaciones','Prueba reversible de cierre'));
 if l.estado<>'cerrada' then raise exception 'Falló cierre de liquidación'; end if;
 insert into public.documentos_socios(socio_id,tipo,estado,nombre_archivo,storage_path,creado_por)
 values(f.id,'Otro','vigente','QA-notificacion.pdf','QA-SIN-ARCHIVO-REAL',actor) returning id into d;
 t:=public.fn_guardar_tramite_baja(jsonb_build_object('socio_id',f.id,'tipo_baja','exclusion','fecha_presentacion',current_date,'documento_solicitud',d,'motivo','Prueba reversible de exclusión'));
 t:=public.fn_guardar_tramite_baja(jsonb_build_object('id',t.id,'socio_id',f.id,'etapa','notificado','fecha_notificacion',current_date,'evidencia_notificacion',d,'observaciones','Notificación sintética de prueba'));
 if t.plazo_hasta<>current_date+30 then raise exception 'Plazo incorrecto'; end if;
 begin
   perform public.fn_guardar_tramite_baja(jsonb_build_object('id',t.id,'socio_id',f.id,'etapa','firme','fecha_efectiva',current_date,'observaciones','Intento temprano de prueba'));
   raise exception 'FALLO: exclusión sin cumplir plazo';
 exception when others then if SQLERRM like 'FALLO:%' then raise; end if; end;
 insert into public.pre_registros(id,nombre_contacto,celular_whatsapp,estado) values
 ('QA-PRE-1','QA sintético 1','000000000','pendiente'),('QA-PRE-2','QA sintético 2','000000000','pendiente');
 n:=public.fn_eliminar_lote('preregistros',array['QA-PRE-1','QA-PRE-2'],'Prueba reversible de eliminación múltiple');
 if n<>2 then raise exception 'Falló eliminación múltiple'; end if;
 perform public.fn_reporte_societario(current_date);
end $test$;
