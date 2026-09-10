import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const operations = readFileSync(new URL("../public/app-operaciones.js", import.meta.url), "utf8");
const safeSequence = readFileSync(new URL("../supabase/migrations/20260910220000_corregir_secuencia_segura.sql", import.meta.url), "utf8");

test("la ficha y tesorería conservan un único saldo real de capital", () => {
  assert.doesNotMatch(app, /capital_integrado\s*\|\|\s*Math\.round/);
  assert.doesNotMatch(app, /cuotas_saldo_pagadas[^\n]+:\s*6/);
  assert.match(app, /Podés corregir el saldo inicial mientras todavía no existan pagos/);
  assert.match(app, /hasCapitalMovements/);
  assert.match(app, /capital_integrado: capitalIntegrado/);
  assert.match(operations, /row\.aporte > pending/);
  assert.match(operations, /Recibo de integración de capital fundacional/);
});

test("la corrección de secuencia preserva matrículas históricas y sincroniza el contador real", () => {
  assert.match(safeSequence, /max\(numero\).*\+ 1/s);
  assert.match(safeSequence, /p_proximo_numero < v_minimo/);
  assert.match(safeSequence, /setval\('public\.socios_matricula_seq', p_proximo_numero, false\)/);
  assert.match(safeSequence, /auditoria_solicitudes/);
});

test("los PDF usan exclusivamente la identidad documental configurada", () => {
  assert.doesNotMatch(app, /documento_logo \|\| documentIdentity\.logo/);
  assert.doesNotMatch(operations, /documento_logo \|\| identity\.logo/);
  assert.match(app, /await window\.cimientosIdentity\?\.load\(\)/);
  assert.match(operations, /await window\.cimientosIdentity\?\.load\(\)/);
});

test("la importación reconoce la planilla institucional sin alterar matrículas", () => {
  assert.match(app, /APORTES\? FUNDADORES\?/);
  assert.match(app, /NOMINA DE SOCIOS FUNDADORES\?/);
  assert.match(app, /Vinculadas por cédula/);
  assert.match(app, /Las matrículas no cambiarán/);
  assert.match(app, /capitalMovements/);
  assert.match(app, /Number\.isFinite\(importedIntegrated\)/);
  assert.match(app, /Cuando ya existen movimientos, nunca los reduce/);
});
