-- Todos los funcionarios activos tienen el mismo acceso operativo.
-- `rol` se conserva únicamente para compatibilidad con las funciones y
-- políticas existentes; `cargo` queda como la descripción visible.

update public.perfiles_admin
set rol = 'superadministrador', updated_at = now()
where rol <> 'superadministrador';

create or replace function public.fn_forzar_acceso_uniforme()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.rol := 'superadministrador';
  return new;
end;
$$;

revoke all on function public.fn_forzar_acceso_uniforme() from public, anon, authenticated;

drop trigger if exists perfiles_admin_acceso_uniforme on public.perfiles_admin;
create trigger perfiles_admin_acceso_uniforme
before insert or update of rol on public.perfiles_admin
for each row execute function public.fn_forzar_acceso_uniforme();

create or replace function public.fn_rol_actual()
returns text
language sql
security definer
set search_path = ''
stable
as $$
  select 'superadministrador'::text
  from public.perfiles_admin
  where id = (select auth.uid()) and activo = true;
$$;

revoke all on function public.fn_rol_actual() from public, anon;
grant execute on function public.fn_rol_actual() to authenticated;

create or replace function public.fn_asegurar_perfil()
returns public.perfiles_admin
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_perfil public.perfiles_admin;
  v_email text;
begin
  if (select auth.uid()) is null then raise exception 'No autenticado'; end if;
  select email into v_email from auth.users where id = (select auth.uid());

  insert into public.perfiles_admin (id, correo, nombre, cargo, rol, activo, ultimo_acceso)
  values ((select auth.uid()), v_email, coalesce(v_email, 'Funcionario'), 'Funcionario',
          'superadministrador', true, now())
  on conflict (id) do update
    set correo = excluded.correo,
        ultimo_acceso = now()
  returning * into v_perfil;

  return v_perfil;
end;
$$;

revoke all on function public.fn_asegurar_perfil() from public, anon;
grant execute on function public.fn_asegurar_perfil() to authenticated;

drop policy if exists "perfil_propio_update" on public.perfiles_admin;
revoke update on public.perfiles_admin from authenticated;

drop policy if exists "perfiles_ver_todos_auth" on public.perfiles_admin;
drop policy if exists "perfiles_ver_activos" on public.perfiles_admin;
create policy "perfiles_ver_activos"
on public.perfiles_admin
for select
to authenticated
using ((select public.fn_rol_actual()) = 'superadministrador');

create or replace function public.fn_actualizar_perfil_propio(
  p_nombre text,
  p_telefono text default null,
  p_cargo text default null,
  p_foto_base64 text default null
)
returns public.perfiles_admin
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.perfiles_admin;
begin
  if (select auth.uid()) is null then raise exception 'No autenticado'; end if;
  if public.fn_rol_actual() is null then raise exception 'Tu usuario no tiene acceso activo'; end if;
  if nullif(trim(p_nombre), '') is null then raise exception 'Ingresá tu nombre'; end if;

  update public.perfiles_admin
  set nombre = trim(p_nombre),
      telefono = nullif(trim(coalesce(p_telefono, '')), ''),
      cargo = coalesce(nullif(trim(coalesce(p_cargo, '')), ''), 'Funcionario'),
      foto_base64 = nullif(p_foto_base64, ''),
      updated_at = now()
  where id = (select auth.uid())
  returning * into v_row;

  if not found then raise exception 'Perfil no encontrado'; end if;
  return v_row;
end;
$$;

revoke all on function public.fn_actualizar_perfil_propio(text,text,text,text) from public, anon;
grant execute on function public.fn_actualizar_perfil_propio(text,text,text,text) to authenticated;
