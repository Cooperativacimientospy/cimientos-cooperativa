import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';
const source = readFileSync(new URL('../public/theme.js', import.meta.url), 'utf8');
function boot(value, unavailable = false) {
  const attributes = {};
  const button = {setAttribute: (k,v) => attributes[k] = v};
  const root = {dataset:{}};
  const store = new Map([['cimientos_appearance', value]]);
  const context = {document:{documentElement:root,getElementById:()=>button},window:{},localStorage:{getItem:k=>{if(unavailable)throw Error();return store.get(k);},setItem:(k,v)=>{if(unavailable)throw Error();store.set(k,v);}}};
  runInNewContext(source, context);
  context.window.CimientosTheme.syncButton();
  return {root,button,attributes,store,theme:context.window.CimientosTheme};
}
let app = boot(null);
assert.equal(app.root.dataset.theme,'light');
app.theme.toggle();
assert.equal(app.root.dataset.theme,'dark');
assert.equal(app.attributes['aria-label'],'Modo claro');
assert.equal(app.attributes['aria-pressed'],'true');
assert.equal(boot(app.store.get('cimientos_appearance')).root.dataset.theme,'dark');
app.theme.toggle();
assert.equal(app.attributes['aria-label'],'Modo oscuro');
assert.equal(boot('invalid').root.dataset.theme,'light');
boot(null,true).theme.toggle();
console.log('OK: cambio claro/oscuro, persistencia, accesibilidad y almacenamiento bloqueado.');
