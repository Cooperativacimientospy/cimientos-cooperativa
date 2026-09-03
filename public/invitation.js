/* Capture callback intent before the Auth SDK consumes the URL fragment.
   This is navigation state, never a grant of permissions. */
(() => {
  const url = new URL(location.href);
  const fragment = new URLSearchParams(url.hash.slice(1));
  const type = fragment.get('type') || url.searchParams.get('type');
  let required = url.searchParams.get('invite') === '1' || ['invite', 'recovery'].includes(type);
  const failed = fragment.has('error') || fragment.has('error_code') || url.searchParams.has('error') || url.searchParams.has('error_code');
  if (required && !failed) {
    url.searchParams.set('invite', '1');
    history.replaceState({}, '', url.pathname + url.search + url.hash);
  }
  function clear() {
    required = false;
    const clean = new URL(location.href);
    ['invite','type','code','error','error_code','error_description'].forEach(k => clean.searchParams.delete(k));
    history.replaceState({}, '', clean.pathname + clean.search);
  }
  function present(auth, userId, onComplete) {
    const login = document.getElementById('loginForm');
    login.hidden = true;
    const form = document.createElement('form');
    form.id = 'passwordSetupForm';
    form.innerHTML = `<h2>Crear tu contraseña</h2><p>Elegí una contraseña para ingresar con tu cuenta. Usá al menos 8 caracteres.</p><div class="formfield" style="margin-bottom:14px"><label for="setupPassword">Nueva contraseña</label><input id="setupPassword" type="password" required minlength="8" autocomplete="new-password"></div><div class="formfield" style="margin-bottom:14px"><label for="setupConfirm">Repetir contraseña</label><input id="setupConfirm" type="password" required minlength="8" autocomplete="new-password"></div><p id="setupError" role="alert"></p><button class="btn btn-primary" type="submit">Guardar contraseña e ingresar</button><p><a href="panel.html" id="setupExit">Volver al inicio de sesión</a></p>`;
    login.after(form);
    const password = form.querySelector('#setupPassword');
    const confirmation = form.querySelector('#setupConfirm');
    const errorBox = form.querySelector('#setupError');
    const button = form.querySelector('button');
    let saving = false;
    form.onsubmit = async event => {
      event.preventDefault();
      if (saving) return;
      errorBox.textContent = '';
      if (password.value.length < 8) {errorBox.textContent = 'Usá al menos 8 caracteres.'; return;}
      if (password.value !== confirmation.value) {errorBox.textContent = 'Las contraseñas no coinciden. Revisalas.'; return;}
      saving = true; button.disabled = true; button.textContent = 'Guardando…';
      try {
        const {data, error: sessionError} = await auth.getUser();
        if (sessionError || data?.user?.id !== userId) throw Error('session');
        const {error} = await auth.updateUser({password: password.value});
        if (error) {
          errorBox.textContent = error.code === 'weak_password'
            ? 'Elegí una contraseña más segura: combiná letras, números y símbolos.'
            : 'No se pudo guardar. Probá otra contraseña o solicitá un nuevo enlace desde el inicio de sesión.';
          return;
        }
        password.value = ''; confirmation.value = '';
        clear(); form.remove(); login.hidden = false;
        onComplete();
      } catch (_) {
        errorBox.textContent = 'No se pudo verificar tu cuenta. Revisá la conexión o solicitá un nuevo enlace desde el inicio de sesión.';
      } finally {
        saving = false; button.disabled = false; button.textContent = 'Guardar contraseña e ingresar';
      }
    };
    form.querySelector('#setupExit').onclick = async event => {
      event.preventDefault();
      if (saving) return;
      try { const {error} = await auth.signOut({scope:'local'}); if (error) throw error; clear(); location.assign('panel.html'); }
      catch (_) { errorBox.textContent = 'No se pudo cerrar la sesión. Intentá nuevamente.'; }
    };
    password.focus();
  }
  window.CimientosInvitation = {get required(){return required;}, failed, present};
})();
