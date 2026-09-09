-- Permite un encabezado documental independiente con la misma validación del panel.
create or replace function public.fn_guardar_identidad(p_identidad jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v jsonb;
begin
  if public.fn_rol_actual() <> 'superadministrador' then raise exception 'Solo un superadministrador puede editar la identidad'; end if;
  if length(coalesce(p_identidad->>'nombre','')) not between 3 and 100 then raise exception 'Nombre inválido'; end if;
  if octet_length(p_identidad::text) > 1600000 then raise exception 'La configuración visual es demasiado pesada'; end if;
  if coalesce(p_identidad->>'logo','') <> '' and p_identidad->>'logo' !~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$' then raise exception 'Logo inválido'; end if;
  if coalesce(p_identidad->>'favicon','') <> '' and p_identidad->>'favicon' !~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$' then raise exception 'Favicon inválido'; end if;
  if coalesce(p_identidad->>'documento_logo','') <> '' and p_identidad->>'documento_logo' !~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$' then raise exception 'Logo documental inválido'; end if;
  insert into public.configuracion_app(clave,valor,updated_at,updated_by) values('identidad',p_identidad,now(),auth.uid())
  on conflict(clave) do update set valor=excluded.valor,updated_at=excluded.updated_at,updated_by=excluded.updated_by returning valor into v;
  return v;
end $$;
revoke all on function public.fn_guardar_identidad(jsonb) from public,anon;
grant execute on function public.fn_guardar_identidad(jsonb) to authenticated;
