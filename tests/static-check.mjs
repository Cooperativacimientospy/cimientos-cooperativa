import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import assert from 'node:assert/strict';
for (const file of ['app.js','app-operaciones.js','identity.js','societario.js']) {
  new Script(readFileSync(new URL(`../public/${file}`,import.meta.url),'utf8'),{filename:file});
}
for (const file of ['panel.html','formulario.html']) {
  const html=readFileSync(new URL(`../public/${file}`,import.meta.url),'utf8');
  for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/\bsrc=/.test(match[1]) && match[2].trim()) new Script(match[2],{filename:file});
  }
}
const panel=readFileSync(new URL('../public/panel.html',import.meta.url),'utf8');
assert(panel.indexOf('src="identity.js"') < panel.indexOf('src="app.js"'));
const formSql=readFileSync(new URL('../supabase/migrations/20260902000200_formulario_sin_firma.sql',import.meta.url),'utf8');
assert(!formSql.includes('La firma es obligatoria'));
assert(formSql.includes('Debe aceptar la declaración jurada'));
const operations=readFileSync(new URL('../public/app-operaciones.js',import.meta.url),'utf8');
assert(!operations.includes('rpc("fn_eliminar_movimiento_aporte"'));
assert(operations.includes('rpc("fn_anular_aportes"'));
console.log('OK: sintaxis JS externa e inline, carga de identidad, declaración jurada y anulación de pagos.');
