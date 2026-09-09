-- Edición segura de datos personales. La matrícula, el estado, la admisión
-- y las relaciones históricas no se reciben desde el navegador.
create or replace function public.fn_actualizar_datos_socio(p_id text, p_datos jsonb)
returns public.solicitudes_socios
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_anterior public.solicitudes_socios;
  v_nuevo public.solicitudes_socios;
begin
  if (select auth.uid()) is null or public.fn_rol_actual() is null then
    raise exception 'Tu sesión no tiene acceso para editar socios';
  end if;
  select * into v_anterior from public.solicitudes_socios where id = p_id for update;
  if not found then raise exception 'No encontramos el socio que querés editar'; end if;
  if v_anterior.estado <> 'aprobado' or v_anterior.numero_socio is null then
    raise exception 'Este registro todavía no es una ficha de socio';
  end if;

  update public.solicitudes_socios set
    apellidos_nombres = coalesce(nullif(trim(p_datos->>'apellidos_nombres'),''), apellidos_nombres),
    cedula = coalesce(nullif(regexp_replace(p_datos->>'cedula','\D','','g'),''), cedula),
    nacionalidad = nullif(trim(p_datos->>'nacionalidad'),''),
    fecha_nacimiento = nullif(p_datos->>'fecha_nacimiento','')::date,
    lugar_nacimiento = nullif(trim(p_datos->>'lugar_nacimiento'),''),
    estado_civil = nullif(trim(p_datos->>'estado_civil'),''),
    genero = nullif(trim(p_datos->>'genero'),''),
    profesion_oficio = nullif(trim(p_datos->>'profesion_oficio'),''),
    ciudad = nullif(trim(p_datos->>'ciudad'),''),
    barrio = nullif(trim(p_datos->>'barrio'),''),
    departamento = nullif(trim(p_datos->>'departamento'),''),
    tipo_vivienda = nullif(trim(p_datos->>'tipo_vivienda'),''),
    direccion = nullif(trim(p_datos->>'direccion'),''),
    celular_whatsapp = nullif(trim(p_datos->>'celular_whatsapp'),''),
    correo_electronico = nullif(trim(p_datos->>'correo_electronico'),''),
    condicion_laboral = nullif(trim(p_datos->>'condicion_laboral'),''),
    empresa_ruc = nullif(trim(p_datos->>'empresa_ruc'),''),
    cargo_laboral = nullif(trim(p_datos->>'cargo_laboral'),''),
    antiguedad_laboral = nullif(trim(p_datos->>'antiguedad_laboral'),''),
    direccion_laboral = nullif(trim(p_datos->>'direccion_laboral'),''),
    ingreso_mensual = nullif(p_datos->>'ingreso_mensual','')::numeric,
    origen_fondos = nullif(trim(p_datos->>'origen_fondos'),''),
    cargo_publico = nullif(trim(p_datos->>'cargo_publico'),''),
    certificados_suscritos = coalesce(nullif(p_datos->>'certificados_suscritos','')::integer, certificados_suscritos),
    capital_suscrito = coalesce(nullif(p_datos->>'capital_suscrito','')::numeric, capital_suscrito),
    capital_integrado = coalesce(nullif(p_datos->>'capital_integrado','')::numeric, capital_integrado),
    cuotas_saldo_pagadas = coalesce(nullif(p_datos->>'cuotas_saldo_pagadas','')::integer, cuotas_saldo_pagadas),
    fecha_constitucion = coalesce(nullif(p_datos->>'fecha_constitucion','')::date, fecha_constitucion),
    datos_pendiente_revision = false
  where id = p_id
  returning * into v_nuevo;

  return v_nuevo;
end;
$$;

revoke all on function public.fn_actualizar_datos_socio(text,jsonb) from public, anon;
grant execute on function public.fn_actualizar_datos_socio(text,jsonb) to authenticated;

-- Adopta la identidad oficial cuando la instalación aún conserva la paleta
-- anterior. Una personalización posterior hecha desde Configuración se respeta.
update public.configuracion_institucional
set identidad = jsonb_build_object(
  'nombre', 'Cooperativa Cimientos',
  'subtitulo', 'Panel de administración',
  'logo', '',
  'favicon', '',
  'green', '#27452C',
  'orange', '#E56915',
  'bg', '#F6F6F6'
), updated_at = now()
where id = 1
  and (
    identidad = '{}'::jsonb
    or coalesce(identidad->>'green', '') in ('', '#6a9c20', '#62951f')
  );
