import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import assert from 'node:assert/strict';
const source=readFileSync(new URL('../public/invitation.js',import.meta.url),'utf8');
function boot(suffix='') {
  const fields=Object.fromEntries(['#setupPassword','#setupConfirm','#setupError','button','#setupExit'].map(k=>[k,{value:'',focus(){}}]));
  const form={querySelector:k=>fields[k],remove(){this.removed=true;}};
  const login={hidden:false,after(){}};
  const location={href:'https://example.test/panel.html'+suffix};
  const context={URL,URLSearchParams,window:{},location,history:{replaceState:(_a,_b,p)=>location.href=new URL(p,location.href).href},document:{getElementById:()=>login,createElement:()=>form}};
  runInNewContext(source,context);
  return {flow:context.window.CimientosInvitation,location,fields,form,login};
}
assert.equal(boot().flow.required,false);
for(const suffix of ['?invite=1','#type=invite','#type=recovery']) {
  const app=boot(suffix); assert.equal(app.flow.required,true);
  assert.equal(new URL(app.location.href).searchParams.get('invite'),'1');
}
assert.equal(boot('#error=access_denied&error_code=otp_expired').flow.failed,true);
let app=boot('#type=invite');
let saves=0, completions=0, fail=false, wrongUser=false;
const auth={getUser:async()=>({data:{user:{id:wrongUser?'other':'test'}}}),updateUser:async()=>{saves++;return {error:fail?{code:'weak_password'}:null};}};
app.flow.present(auth,'test',()=>completions++);
assert.equal(app.login.hidden,true);
const submit=()=>app.form.onsubmit({preventDefault(){}});
app.fields['#setupPassword'].value='example-password';
app.fields['#setupConfirm'].value='different';
await submit(); assert.equal(saves,0); assert.match(app.fields['#setupError'].textContent,/no coinciden/);
app.fields['#setupConfirm'].value='example-password';
wrongUser=true; await submit(); assert.equal(saves,0);
wrongUser=false; fail=true; await submit(); assert.equal(completions,0); assert.equal(app.fields.button.disabled,false);
fail=false; await submit(); assert.equal(completions,1); assert.equal(app.form.removed,true); assert.equal(app.flow.required,false);
assert.equal(app.fields['#setupPassword'].value,''); assert.equal(new URL(app.location.href).hash,'');
console.log('OK: invitación, recuperación, enlace vencido, confirmación, cambio de cuenta, rechazo y guardado.');
