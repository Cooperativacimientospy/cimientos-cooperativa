(function () {
  "use strict";
  const defaults = { nombre: "Cooperativa Cimientos", subtitulo: "Panel de administración", logo: "", favicon: "", green: "#6a9c20", orange: "#ff7a00", bg: "#f3f4f1" };
  const key = "cimientos_identidad_v1";
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const raster = value => /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value);
  let current = { ...defaults }, loaded = false;
  function sanitize(raw) {
    const v = { ...defaults };
    for (const k of ["nombre", "subtitulo"]) if (typeof raw?.[k] === "string") v[k] = raw[k].slice(0,100);
    for (const k of ["logo", "favicon"]) if (raster(raw?.[k])) v[k] = raw[k];
    for (const k of ["green", "orange", "bg"]) if (/^#[\da-f]{6}$/i.test(raw?.[k])) v[k] = raw[k];
    return v;
  }
  function apply() {
    document.title = `${current.nombre} — Panel de administración`;
    document.querySelectorAll(".brand").forEach(brand => {
      const name = brand.querySelector("strong"), subtitle = brand.querySelector("span"), logo = brand.querySelector("img");
      if (name) name.textContent = current.nombre;
      if (subtitle) subtitle.textContent = current.subtitulo;
      if (logo) { if (!logo.dataset.originalSrc) logo.dataset.originalSrc = logo.getAttribute("src"); logo.src = current.logo || logo.dataset.originalSrc; logo.alt = current.nombre; }
    });
    document.querySelectorAll('link[rel="icon"],link[rel="apple-touch-icon"]').forEach(link => {
      if (!link.dataset.originalHref) link.dataset.originalHref = link.getAttribute("href");
      link.href = current.favicon || link.dataset.originalHref;
      if (current.favicon) { link.removeAttribute("type"); link.removeAttribute("sizes"); }
    });
    for (const k of ["green", "orange", "bg"]) document.documentElement.style.setProperty(`--${k}`, current[k]);
  }
  async function load() {
    const client = window.cimientosSupabase;
    try {
      let raw;
      if (client) { const result = await client.rpc("fn_identidad_publica"); if (result.error) throw result.error; raw = result.data; }
      else raw = JSON.parse(localStorage.getItem(key) || "{}");
      current = sanitize(raw); loaded = true; apply();
    } catch (_) { loaded = false; }
  }
  async function readImage(file) {
    if (!file) return null;
    if (!["image/png","image/jpeg","image/webp"].includes(file.type)) throw Error("Elegí una imagen PNG, JPG o WebP.");
    if (file.size > 500000) throw Error("Cada imagen puede pesar hasta 500 KB.");
    const value = await new Promise((resolve,reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(Error("No se pudo leer la imagen.")); r.readAsDataURL(file); });
    const img = new Image(); img.src = value; await img.decode();
    if (img.width > 4096 || img.height > 4096) throw Error("Usá una imagen de hasta 4.096 píxeles por lado.");
    return value;
  }
  async function render(panel, allowed) {
    panel.innerHTML = '<h2>Identidad visual</h2><p>Cargando configuración institucional…</p>';
    await load();
    if (!panel.isConnected) return;
    const draft = { ...current };
    panel.innerHTML = `<h2>Identidad visual</h2><p>Nombre, logo y favicon del panel. Se aplican para todo el equipo; no cambian la razón social de la cooperativa en los documentos.</p>${!loaded ? '<p role="alert">No se pudo cargar la configuración. Recargá antes de guardar.</p>' : ""}<form id="identityForm"><fieldset ${allowed && loaded ? "" : "disabled"} style="border:0;padding:0;margin:0"><div class="formgrid"><label class="formfield">Nombre del panel<input name="nombre" required minlength="3" maxlength="100" value="${esc(draft.nombre)}"></label><label class="formfield">Descripción corta<input name="subtitulo" maxlength="100" value="${esc(draft.subtitulo)}"></label>${["logo","favicon"].map(k => `<div class="formfield"><label for="identity-${k}">${k === "logo" ? "Logo" : "Favicon (ícono de la pestaña)"}</label><img id="preview-${k}" src="${draft[k] || (k === "logo" ? "assets/logo-cimientos.png" : "assets/favicon-32.png")}" alt="Vista previa de ${k}" style="width:100px;height:64px;object-fit:contain;margin:10px 0"><input id="identity-${k}" type="file" accept="image/png,image/jpeg,image/webp"><button type="button" class="linkbtn" data-reset-image="${k}">Usar original</button></div>`).join("")}</div><p>PNG, JPG o WebP · hasta 500 KB. Para el favicon, preferí una imagen cuadrada.</p><div class="colorrow">${["green","orange","bg"].map((k,i) => `<label class="colorbox">${["Principal","Acento","Fondo"][i]}<input type="color" name="${k}" value="${draft[k]}"></label>`).join("")}</div><button class="btn btn-primary" type="submit" style="margin-top:20px">Guardar identidad</button></fieldset><p role="status" id="identityStatus">${allowed ? "" : "Solo un superadministrador puede cambiar esta configuración."}</p></form>`;
    const status = panel.querySelector("#identityStatus");
    for (const k of ["logo","favicon"]) panel.querySelector(`#identity-${k}`).onchange = async e => {
      const input = e.target; panel.querySelector('[type="submit"]').disabled = true;
      try { const value = await readImage(input.files[0]); if (value) { draft[k] = value; panel.querySelector(`#preview-${k}`).src = value; } status.textContent = ""; }
      catch (err) { input.value = ""; status.textContent = err.message; }
      finally { panel.querySelector('[type="submit"]').disabled = false; }
    };
    panel.querySelectorAll("[data-reset-image]").forEach(b => b.onclick = () => { const k = b.dataset.resetImage; draft[k] = ""; panel.querySelector(`#identity-${k}`).value = ""; panel.querySelector(`#preview-${k}`).src = k === "logo" ? "assets/logo-cimientos.png" : "assets/favicon-32.png"; });
    panel.querySelector("form").onsubmit = async e => {
      e.preventDefault(); if (!allowed || !loaded) return;
      const values = sanitize({ ...draft, ...Object.fromEntries(new FormData(e.target)) });
      if (values.nombre.trim().length < 3) { status.textContent = "Escribí el nombre del panel."; return; }
      e.submitter.disabled = true;
      try {
        const client = window.cimientosSupabase;
        if (client) { const {error} = await client.rpc("fn_guardar_identidad", {p_identidad:values}); if (error) throw error; }
        else localStorage.setItem(key, JSON.stringify(values));
        current = values; apply(); status.textContent = client ? "Identidad guardada para todo el equipo." : "Identidad guardada en este navegador.";
      } catch (err) { status.textContent = err.message || "No se pudo guardar. Tus cambios no se aplicaron."; }
      finally { e.submitter.disabled = false; }
    };
  }
  window.cimientosIdentity = {render, apply, get: () => ({...current}), load};
  window.addEventListener("DOMContentLoaded", load);
})();
