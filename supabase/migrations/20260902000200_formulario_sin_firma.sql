-- Mantiene la declaración jurada; no captura ni exige firma digital.
begin;
CREATE OR REPLACE FUNCTION public.enviar_solicitud(p_datos jsonb)
 RETURNS TABLE(numero_solicitud bigint, referencia text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_numero bigint;
  v_cedula text := regexp_replace(coalesce(p_datos->>'cedula',''), '\D', '', 'g');
begin
  if length(trim(coalesce(p_datos->>'apellidos_nombres',''))) < 3 then raise exception 'El nombre completo es obligatorio'; end if;
  if length(v_cedula) < 5 then raise exception 'La cédula no es válida'; end if;
  if coalesce((p_datos->>'declaracion_jurada')::boolean, false) is not true then raise exception 'Debe aceptar la declaración jurada'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_cedula, 5726));
  if exists (
    select 1 from public.solicitudes_socios s
    where regexp_replace(s.cedula, '\D', '', 'g') = v_cedula
      and (s.estado in ('pendiente','observada') or (s.estado='aprobado' and coalesce(s.estado_societario,'activo') not in ('baja_voluntaria','excluido','expulsado')))
  ) then raise exception 'Ya existe una solicitud vigente para esta cédula'; end if;

  insert into public.solicitudes_socios (
    tipo_socio, apellidos_nombres, nacionalidad, estado_civil, cedula, fecha_nacimiento,
    profesion_oficio, genero, ciudad, barrio, departamento, tipo_vivienda, direccion,
    celular_whatsapp, correo_electronico, contacto_preferido, condicion_laboral, empresa_ruc,
    cargo_laboral, antiguedad_laboral, direccion_laboral, cargo_publico, trabajo_ong,
    origen_fondos, cuotas_partes_suscriptas, monto_aporte_inicial, forma_pago,
    referente_nombre, referente_cedula, beneficiarios, declaracion_jurada, firma_base64, lugar_nacimiento, ingreso_mensual, membresia_anterior_id
  ) values (
    'ordinario', trim(p_datos->>'apellidos_nombres'), p_datos->>'nacionalidad',
    p_datos->>'estado_civil', trim(p_datos->>'cedula'), nullif(p_datos->>'fecha_nacimiento','')::date,
    p_datos->>'profesion_oficio', nullif(p_datos->>'genero',''), p_datos->>'ciudad',
    p_datos->>'barrio', p_datos->>'departamento', p_datos->>'tipo_vivienda',
    p_datos->>'direccion', p_datos->>'celular_whatsapp', nullif(p_datos->>'correo_electronico',''),
    p_datos->>'contacto_preferido', p_datos->>'condicion_laboral', p_datos->>'empresa_ruc',
    p_datos->>'cargo_laboral', p_datos->>'antiguedad_laboral', p_datos->>'direccion_laboral',
    p_datos->>'cargo_publico', p_datos->>'trabajo_ong', p_datos->>'origen_fondos',
    nullif(p_datos->>'cuotas_partes_suscriptas','')::numeric,
    nullif(p_datos->>'monto_aporte_inicial','')::numeric, p_datos->>'forma_pago',
    p_datos->>'referente_nombre', p_datos->>'referente_cedula',
    coalesce(p_datos->'beneficiarios','[]'::jsonb), true, null,
    nullif(trim(p_datos->>'lugar_nacimiento'),''), nullif(p_datos->>'ingreso_mensual','')::numeric,
    (select s.id from public.solicitudes_socios s where regexp_replace(s.cedula,'\D','','g')=v_cedula and s.estado_societario in ('baja_voluntaria','excluido','expulsado') order by s.fecha_perdida_calidad desc nulls last limit 1)
  ) returning solicitudes_socios.numero_solicitud into v_numero;

  return query select v_numero, 'SOL-' || to_char(current_date, 'YYYY') || '-' || lpad(v_numero::text, 6, '0');
end;
$function$;
commit;
