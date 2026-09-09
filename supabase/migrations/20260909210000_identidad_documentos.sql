-- Permite un encabezado documental independiente con la misma validación del panel.
alter table public.configuracion_institucional add column if not exists identidad jsonb not null default '{}'::jsonb;

create or replace function public.fn_guardar_identidad(p_identidad jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or coalesce(public.fn_rol_actual(),'') <> 'superadministrador' then raise exception 'Solo un superadministrador puede editar la identidad'; end if;
  if length(coalesce(p_identidad->>'nombre','')) not between 3 and 100 then raise exception 'Nombre inválido'; end if;
  if octet_length(p_identidad::text) > 1600000 then raise exception 'La configuración visual es demasiado pesada'; end if;
  if coalesce(p_identidad->>'logo','') <> '' and p_identidad->>'logo' !~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$' then raise exception 'Logo inválido'; end if;
  if coalesce(p_identidad->>'favicon','') <> '' and p_identidad->>'favicon' !~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$' then raise exception 'Favicon inválido'; end if;
  if coalesce(p_identidad->>'documento_logo','') <> '' and p_identidad->>'documento_logo' !~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$' then raise exception 'Logo documental inválido'; end if;
  update public.configuracion_institucional set identidad=p_identidad,updated_at=now() where id=1;
  if not found then raise exception 'Falta la configuración institucional'; end if;
  return p_identidad;
end $$;
revoke all on function public.fn_guardar_identidad(jsonb) from public,anon;
grant execute on function public.fn_guardar_identidad(jsonb) to authenticated;
