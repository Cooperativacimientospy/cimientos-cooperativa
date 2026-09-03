import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const panel = readFileSync(new URL('../public/panel.html', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20260903174021_acceso_uniforme_funcionarios.sql', import.meta.url), 'utf8');

assert(!panel.includes('Roles y permisos'));
assert(!app.includes('data-role-for'));
assert(!app.includes('name="rol"'));
assert(app.includes('Todos los usuarios activos acceden a todas las funciones'));
assert(app.includes('rpc("fn_actualizar_perfil_propio"'));
assert(migration.includes("where id = (select auth.uid()) and activo = true"));
assert(migration.includes('revoke update on public.perfiles_admin from authenticated'));
assert(migration.includes("new.rol := 'superadministrador'"));

console.log('OK: acceso uniforme para usuarios activos, cargo descriptivo y perfil protegido.');
