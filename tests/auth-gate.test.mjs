import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import assert from 'node:assert/strict';
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const gate=source.slice(source.indexOf('  async function initAuthGate()'),source.lastIndexOf('\n  initAuthGate();'));
async function boot({required=false,failed=false,session=true,error=null}={}) {
  let starts=0, presented=0, complete;
  const nodes=new Map();
  const $=id=>{if(!nodes.has(id))nodes.set(id,{style:{},value:'',addEventListener(){}});return nodes.get(id);};
  const app={};
  const context={$,loginRequired:true,supabaseClient:{auth:{getSession:async()=>({data:{session:session?{user:{id:'fixture'}}:null},error})}},window:{CimientosInvitation:{required,failed,present(_auth,id,done){assert.equal(id,'fixture');presented++;complete=done;}}},document:{querySelectorAll:()=>[app]},console,startApp:()=>starts++,toast:()=>{}};
  await runInNewContext(gate+'\ninitAuthGate();',context);
  return {get starts(){return starts;},presented,complete,app,nodes};
}
let result=await boot({required:true});
assert.equal(result.starts,0);assert.equal(result.presented,1);assert.equal(result.app.inert,true);
result.complete();assert.equal(result.starts,1);assert.equal(result.app.inert,false);
for (const state of [{required:true,session:false},{failed:true},{required:true,error:{message:'invalid'}}]) {
  result=await boot(state);assert.equal(result.starts,0);assert.equal(result.presented,0);assert.match(result.nodes.get('#loginError').textContent,/enlace/);
}
assert.equal((await boot()).starts,1);
assert.equal((await boot({session:false})).starts,0);
console.log('OK: el panel espera la contraseña; bloquea enlaces inválidos; conserva el acceso normal.');
