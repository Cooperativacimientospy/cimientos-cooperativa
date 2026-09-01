(function () {
  "use strict";

  const KEYS = {
    solicitudes: "cimientos_local_v1_solicitudes",
    leads: "cimientos_local_v1_preregistros",
    actividad: "cimientos_ios_v1_actividad",
    config: "cimientos_ios_v1_config",
    theme: "cimientos_ios_v1_theme"
  };
  const cloudConfigured =
    typeof SUPABASE_URL !== "undefined" && typeof SUPABASE_ANON_KEY !== "undefined" &&
    SUPABASE_URL && SUPABASE_ANON_KEY &&
    !String(SUPABASE_URL).startsWith("PONE_ACA") &&
    !String(SUPABASE_ANON_KEY).startsWith("PONE_ACA");

  // Base para armar links absolutos (WhatsApp de pre-registro, etc.).
  // OJO: no alcanza con location.origin — el panel vive en GitHub Pages
  // bajo un subdirectorio (usuario.github.io/repositorio/panel.html), y
  // location.origin es solo "https://usuario.github.io" (sin el
  // "/repositorio"). Armar el link con origin + "/formulario.html" lo
  // manda a la raíz del dominio, no a donde realmente está el formulario.
  // Por eso se usa location.href (la URL completa de esta página) y se le
  // saca el nombre de archivo, así el resultado queda siempre en el mismo
  // directorio que panel.html, sea cual sea la profundidad.
  // Si alguien abre panel.html como archivo local (doble clic, o "Abrir
  // archivo" del navegador) en vez de por la web real, location.protocol
  // es "file:" y no hay ningún directorio real del que partir — ahí se usa
  // SITE_URL de config.js si está cargada; si no, se avisa en vez de
  // generar un link inútil.
  function siteBase() {
    if (location.protocol === "http:" || location.protocol === "https:") {
      return location.href.replace(/\/[^\/?#]*(?:[?#].*)?$/, "");
    }
    if (typeof SITE_URL !== "undefined" && SITE_URL && !String(SITE_URL).startsWith("PONE_ACA")) {
      return String(SITE_URL).replace(/\/+$/, "");
    }
    return null;
  }
  const DEFAULTS = { green: "#6a9c20", orange: "#ff7a00", bg: "#f3f4f1", proximoSocio: 1, administrador: "Administrador local", correoAdministrador: "", cargoAdministrador: "Superadministrador", fotoAdministrador: "" };
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; } catch (_) { return fallback; } };
  const write = (key, value) => {
    if (cloudConfigured && [KEYS.solicitudes, KEYS.leads, KEYS.actividad].includes(key)) return;
    localStorage.setItem(key, JSON.stringify(value));
  };
  const fmtDate = (v) => { if (!v) return "—"; const raw = String(v); const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T12:00:00` : raw); return Number.isNaN(d.getTime()) ? esc(v) : new Intl.DateTimeFormat("es-PY", { day: "2-digit", month: "2-digit", year: "numeric" }).format(d); };
  const fmtGs = (v) => "Gs. " + (Number(v) || 0).toLocaleString("es-PY");
  const parseGs = (v) => Number(String(v == null ? "" : v).replace(/[^0-9-]/g, "")) || 0;
  const fmtGsInput = (v) => parseGs(v).toLocaleString("es-PY");
  function bindGsInput(input) {
    if (!input) return;
    const format = () => { input.value = fmtGsInput(input.value); };
    input.addEventListener("focus", () => { input.value = String(parseGs(input.value)); input.select(); });
    input.addEventListener("blur", format);
    format();
  }
  const now = () => new Date().toISOString();

  let solicitudes = cloudConfigured ? [] : read(KEYS.solicitudes, []);
  let leads = cloudConfigured ? [] : read(KEYS.leads, []);
  let actividad = cloudConfigured ? [] : read(KEYS.actividad, []);
  let config = Object.assign({}, DEFAULTS, read(KEYS.config, {}));
  let filter = "todos";
  let memberFilter = "todos";
  let dark = false;
  // Configuración institucional (próximo N.º de socio, cierre de la
  // nómina fundacional, mensaje, derecho de admisión) y el perfil de
  // quien está logueado: cuando hay Supabase, viven en el servidor,
  // no en este navegador — ver supabase-migracion-p0.sql.
  let configInstitucional = null;
  let perfilActual = null;
  window.cimientosData = {
    solicitudes: () => solicitudes,
    preregistros: () => leads
  };
  function rolActual() { return perfilActual ? perfilActual.rol : "superadministrador"; }
  function puedeGestionar() { return rolActual() !== "lectura"; }
  function esSuperadmin() { return rolActual() === "superadministrador"; }

  // ---------------- Supabase (opcional) ----------------
  // Mientras config.js tenga los valores de ejemplo "PONE_ACA_...", el
  // panel sigue funcionando 100% local (localStorage), exactamente como
  // antes. Apenas config.js tenga la URL y la key reales de un proyecto
  // Supabase, cada cambio también se guarda ahí, y al abrir el panel se
  // carga primero lo local (instantáneo) y después se actualiza con lo
  // que haya en Supabase (para que varias personas vean lo mismo).
  const TABLES = { solicitudes: "solicitudes_socios", leads: "pre_registros", actividad: "actividad" };
  const supabaseReady = cloudConfigured;
  const supabaseClient = supabaseReady && window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
  // Los módulos operativos reutilizan exactamente la misma sesión; crear
  // otro cliente de Auth en la misma página puede producir condiciones de
  // carrera al renovar tokens.
  window.cimientosSupabase = supabaseClient;

  async function upsertRemote(table, row) {
    if (!supabaseClient || !row) return;
    try {
      const { error } = await supabaseClient.from(table).upsert(row);
      if (error) { console.error("Supabase (" + table + "):", error.message); toast("No se pudo sincronizar con Supabase"); }
    } catch (err) { console.error("Supabase (" + table + "):", err); }
  }
  async function deleteRemote(table, id) {
    if (!supabaseClient || !id) return;
    try {
      const { error } = await supabaseClient.from(table).delete().eq("id", id);
      if (error) { console.error("Supabase (" + table + "):", error.message); toast("No se pudo sincronizar con Supabase"); }
    } catch (err) { console.error("Supabase (" + table + "):", err); }
  }
  async function cargarDesdeSupabase() {
    if (!supabaseClient) return;
    try {
      const [sol, lea, act] = await Promise.all([
        supabaseClient.from(TABLES.solicitudes).select("*").order("created_at", { ascending: false }),
        supabaseClient.from(TABLES.leads).select("*").order("created_at", { ascending: false }),
        supabaseClient.from(TABLES.actividad).select("*").order("fecha", { ascending: false }).limit(100),
      ]);
      if (!sol.error && Array.isArray(sol.data)) { solicitudes = sol.data; write(KEYS.solicitudes, solicitudes); }
      if (!lea.error && Array.isArray(lea.data)) { leads = lea.data; write(KEYS.leads, leads); }
      if (!act.error && Array.isArray(act.data)) { actividad = act.data; write(KEYS.actividad, actividad); }
      if (sol.error) console.error("Supabase (solicitudes_socios):", sol.error.message);
      if (lea.error) console.error("Supabase (pre_registros):", lea.error.message);
      if (act.error) console.error("Supabase (actividad):", act.error.message);
      renderAll();
    } catch (err) { console.error("Supabase (carga inicial):", err); }
  }

  async function cargarConfigInstitucional() {
    if (!supabaseClient) return;
    try {
      const { data, error } = await supabaseClient.from("configuracion_institucional").select("*").eq("id", 1).maybeSingle();
      if (error) { console.error("Supabase (configuracion_institucional):", error.message); return; }
      configInstitucional = data || null;
    } catch (err) { console.error("Supabase (configuracion_institucional):", err); }
  }

  async function cargarPerfilActual() {
    if (!supabaseClient) return;
    try {
      const { data, error } = await supabaseClient.rpc("fn_asegurar_perfil");
      if (error) { console.error("Supabase (perfil):", error.message); return; }
      if (data && data.activo === false) {
        await supabaseClient.auth.signOut();
        throw Error("Este usuario fue desactivado por un administrador");
      }
      perfilActual = data;
      supabaseClient.from("perfiles_admin").update({ ultimo_acceso: now() }).eq("id", data.id).then(() => {});
    } catch (err) { console.error("Supabase (perfil):", err); }
  }

  function saveSolicitudes(changed) { write(KEYS.solicitudes, solicitudes); if (changed) upsertRemote(TABLES.solicitudes, changed); }
  function saveLeads(changed) { write(KEYS.leads, leads); if (changed) upsertRemote(TABLES.leads, changed); }
  function log(texto) {
    actividad.unshift({ id: Date.now(), texto, fecha: now(), usuario: config.administrador });
    actividad = actividad.slice(0, 100);
    write(KEYS.actividad, actividad);
    if (supabaseClient) upsertRemote(TABLES.actividad, { texto, fecha: now(), usuario: config.administrador });
    renderActivity();
  }
  function toast(msg) { const e = $("#toast"); e.textContent = msg; e.classList.add("show"); setTimeout(() => e.classList.remove("show"), 1900); }
  function go(name) { $$(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + name)); $$('[data-go]').forEach((b) => b.classList.toggle("active", b.dataset.go === name)); if (name === "inicio") renderHome(); if (name === "socios") renderMembers(); if (name === "actividad") renderActivity(); window.scrollTo({ top: 0, behavior: "smooth" }); }
  function badge(s) { const labels = { pendiente: "Pendiente", observado: "Observada", observada: "Observada", aprobado: "Aprobada", rechazado: "Rechazada", preparado: "Link preparado", copiado: "Link copiado", enviado: "Enviado por WhatsApp", iniciado: "Formulario iniciado", completado: "Completado", vencido: "Token vencido", revocado: "Revocado", descartado: "Descartado", activo: "Activo" }; const cls = s === "observado" ? "observada" : s; return `<span class="badge ${esc(cls)}">${labels[s] || esc(s)}</span>`; }
  // Ciclo de vida del token de pre-registro: preparado -> copiado -> enviado
  // -> completado, con vencido (token_expira_at pasado) y revocado (acción
  // manual del administrador) como salidas. "Vencido" se calcula al vuelo,
  // no se guarda, para no depender de un proceso en segundo plano.
  function leadEstadoEfectivo(r) {
    const estado = r.estado || "pendiente";
    if (["completado", "descartado", "revocado"].includes(estado)) return estado;
    if (r.token_expira_at && new Date(r.token_expira_at) < new Date()) return "vencido";
    return estado;
  }
  // Solo avanza el estado hacia adelante en el ciclo de vida (nunca lo
  // retrocede: si ya está completado no lo vuelve a "enviado", por ejemplo).
  function avanzarEstadoLead(r, nuevo) {
    const orden = ["pendiente", "preparado", "copiado", "enviado", "iniciado", "completado"];
    const actual = orden.indexOf(r.estado || "pendiente");
    const siguiente = orden.indexOf(nuevo);
    if (siguiente > actual) r.estado = nuevo;
  }
  async function revocarToken(r) {
    if (!confirm(`¿Revocar el link de admisión de ${r.nombre_contacto}? Ya no va a poder usarlo para completar el formulario.`)) return;
    if (supabaseClient) {
      try {
        const { data, error } = await supabaseClient.rpc("fn_revocar_token_preregistro", { p_id: r.id });
        if (error) throw error;
        Object.assign(r, data); write(KEYS.leads, leads);
        log(`${perfilActual ? perfilActual.nombre : config.administrador} revocó el link de admisión de ${r.nombre_contacto}`);
        closeModal(); renderAll(); toast("Link revocado");
      } catch (err) { toast(friendlyError(err, "No se pudo revocar el link")); }
      return;
    }
    r.estado = "revocado"; r.token = null; saveLeads(r);
    log(`${config.administrador} revocó el link de admisión de ${r.nombre_contacto}`);
    closeModal(); renderAll(); toast("Link revocado");
  }
  function modal(title, html) { $("#modalTitle").textContent = title; $("#modalBody").innerHTML = html; $("#modalBack").classList.add("open"); }
  function closeModal() { $("#modalBack").classList.remove("open"); }

  // "+ Nueva solicitud" abre el formulario en una ventana flotante adentro
  // del propio panel (iframe), en vez de una pestaña aparte — así no se
  // pierde el contexto de lo que se estaba mirando. El link real
  // (href="formulario.html?admin=1" target="_blank") queda como respaldo:
  // clic con Ctrl/Cmd/rueda del mouse lo sigue abriendo en pestaña nueva.
  function abrirNuevaSolicitud() {
    $("#nuevaSolicitudFrame").src = "formulario.html?admin=1";
    $("#nuevaSolicitudBack").classList.add("open");
  }
  function cerrarNuevaSolicitud() {
    $("#nuevaSolicitudBack").classList.remove("open");
    $("#nuevaSolicitudFrame").src = "about:blank";
  }
  $$('[data-nueva-solicitud]').forEach((a) => a.addEventListener("click", (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
    e.preventDefault();
    abrirNuevaSolicitud();
  }));
  $("#nuevaSolicitudClose").onclick = () => cerrarNuevaSolicitud();
  $("#nuevaSolicitudBack").onclick = (e) => { if (e.target === $("#nuevaSolicitudBack")) cerrarNuevaSolicitud(); };
  // El formulario (formulario.html), cuando corre adentro de esta ventana
  // flotante, avisa por postMessage en vez de navegar el iframe: al
  // enviar una solicitud (para refrescar la tabla ya mismo) y al hacer
  // clic en "Volver al panel" (para cerrar la ventana).
  window.addEventListener("message", (ev) => {
    const data = ev.data;
    if (!data || typeof data !== "object") return;
    if (data.tipo === "cimientos:solicitud_creada") { renderAll(); }
    if (data.tipo === "cimientos:cerrar_formulario") { cerrarNuevaSolicitud(); if (data.creada) { renderAll(); toast("Solicitud creada"); } }
  });
  function nombre(r) { return r.apellidos_nombres || r.nombre || "Sin nombre"; }
  function tel(r) { return r.celular_whatsapp || r.tel || ""; }
  // Normaliza celulares paraguayos a formato internacional sin "+" ni espacios
  // (0981234567 -> 595981234567). Si ya viene con 595 adelante, lo deja igual.
  function normalizePhone(raw) {
    let d = String(raw || "").replace(/\D/g, "");
    if (!d) return "";
    if (d.startsWith("595")) return d;
    if (d.startsWith("0")) return "595" + d.slice(1);
    return "595" + d;
  }
  // Abre WhatsApp Web (no la app) porque el panel se usa desde una compu.
  // Devuelve true/false para que el que llama sepa si hubo número válido.
  function abrirWhatsApp(rawPhone, mensaje) {
    const phone = normalizePhone(rawPhone);
    if (!phone) { toast("No hay un número de WhatsApp válido"); return false; }
    toast("Abriendo WhatsApp Web…");
    const url = `https://web.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(mensaje)}`;
    window.open(url, "_blank", "noopener,noreferrer");
    return true;
  }
  // Traduce errores técnicos de Supabase/PostgREST a mensajes en español que
  // una persona no técnica pueda entender. Si no reconoce el error, usa el
  // mensaje de respaldo (fallback) en vez de mostrar el texto crudo.
  function friendlyError(err, fallback) {
    const raw = String((err && err.message) || err || "");
    const code = String((err && err.code) || "");
    const reglas = [
      [/could not find the function|could not find the table|schema cache/i, "El sistema todavía no tiene la última actualización instalada en la base de datos. Avisá al administrador técnico."],
      [/duplicate key|unique constraint|ya existe|already exists/i, "Ya existe un registro con esos datos (cédula o número de socio duplicado)."],
      [/jwt expired|invalid token|invalid jwt/i, "Tu sesión expiró. Volvé a iniciar sesión."],
      [/permission denied|row-level security|rls|policy/i, "No tenés permisos para hacer esta acción."],
      [/failed to fetch|networkerror|network request failed/i, "No hay conexión con el servidor. Revisá tu internet e intentá de nuevo."],
      [/violates foreign key/i, "No se puede completar: hay datos relacionados que lo impiden."],
      [/violates check constraint|invalid input syntax/i, "Uno de los valores ingresados no es válido."],
      [/timeout|timed out/i, "El servidor tardó demasiado en responder. Intentá de nuevo."]
    ];
    for (const [patron, msg] of reglas) { if (patron.test(raw) || patron.test(code)) return msg; }
    // Si el mensaje no coincide con ningún patrón técnico conocido, es
    // probablemente un mensaje que el propio código ya redactó en español
    // (ej. validaciones de formulario) — se muestra tal cual en vez de
    // ocultarlo detrás de un mensaje genérico.
    return raw || fallback || "Ocurrió un error inesperado. Intentá de nuevo o contactá al administrador técnico.";
  }
  // Deshabilita un botón mientras su acción está en curso, para evitar que
  // un doble clic dispare la misma operación dos veces (ej. aprobar una
  // solicitud, generar un token, abrir WhatsApp).
  function busyClick(btn, handler) {
    return async (...args) => {
      if (!btn || btn.disabled) return;
      const prevOpacity = btn.style.opacity, prevCursor = btn.style.cursor;
      btn.disabled = true; btn.style.opacity = ".55"; btn.style.cursor = "wait";
      try { await handler(...args); }
      finally { if (btn && btn.isConnected) { btn.disabled = false; btn.style.opacity = prevOpacity; btn.style.cursor = prevCursor; } }
    };
  }
  function tipoSocio(r) { return r.tipo_socio === "fundador" ? "fundador" : "ordinario"; }
  function initials(r) { const n = nombre(r).trim(); if (!n || n === "Sin nombre") return "?"; const parts = n.split(/\s+/).filter(Boolean); return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || "?"; }
  function avatarHtml(r, size) { size = size || 34; return r.foto_base64 ? `<img src="${r.foto_base64}" alt="" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;flex:0 0 auto">` : `<span class="avatar" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.38)}px;flex:0 0 auto">${esc(initials(r))}</span>`; }
  function photoPickerHtml(r) {
    return `<div style="display:flex;align-items:center;gap:12px;margin-bottom:16px" id="photoPicker">
      <div id="photoPreview">${avatarHtml(r, 56)}</div>
      <div>
        <label class="btn btn-secondary btn-sm" style="cursor:pointer" for="photoInput">${r.foto_base64 ? "Cambiar foto" : "Agregar foto"}</label>
        <input type="file" id="photoInput" accept="image/*" style="display:none">
        <p style="margin:5px 0 0;font-size:11px;color:var(--muted)">Opcional. Se guarda en este navegador junto al resto de la ficha.</p>
      </div>
    </div>`;
  }
  function wirePhotoPicker(r) {
    const input = $("#photoInput");
    if (!input) return;
    input.onchange = () => {
      const file = input.files && input.files[0];
      if (!file) return;
      if (!file.type.startsWith("image/")) return toast("Elegí un archivo de imagen");
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const size = 160;
          const canvas = document.createElement("canvas");
          canvas.width = size; canvas.height = size;
          const ctx = canvas.getContext("2d");
          const scale = Math.max(size / img.width, size / img.height);
          const w = img.width * scale, h = img.height * scale;
          ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
          r.foto_base64 = canvas.toDataURL("image/jpeg", 0.85);
          saveSolicitudes(r);
          const preview = $("#photoPreview");
          if (preview) preview.innerHTML = avatarHtml(r, 56);
          const label = $('label[for="photoInput"]');
          if (label) label.textContent = "Cambiar foto";
          renderAll();
          toast("Foto actualizada");
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    };
  }
  const FECHA_CONSTITUCION = "2026-08-22";
  // Logo oficial de la cooperativa (marca redonda: engranaje + excavadora +
  // fábrica + apretón de manos), provisto por el usuario el 31/08/2026.
  // Va embebido en base64 para que la ficha impresa/PDF sea un archivo
  // autocontenido (no depende de que "assets/" viaje junto con el HTML).
  const LOGO_MARK_DATA_URI = "data:image/png;base64,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";

  function renderHome() {
    const pendientes = solicitudes.filter((r) => r.estado === "pendiente").length;
    const abiertos = leads.filter((r) => ["pendiente", "enviado", "preparado", "iniciado"].includes(r.estado)).length;
    const socios = solicitudes.filter((r) => r.estado === "aprobado").length;
    const kpis = $$("#view-inicio .kpi strong");
    if (kpis[0]) kpis[0].textContent = pendientes;
    if (kpis[1]) kpis[1].textContent = abiertos;
    if (kpis[2]) kpis[2].textContent = socios;
    if (kpis[3]) kpis[3].textContent = actividad.length;
    const alertas = [];
    if (pendientes) alertas.push(`<div class="item"><span class="dot"></span><div class="item-main"><strong>${pendientes} solicitud(es) esperan revisión</strong><small>Abrí Admisión para continuar.</small></div>${badge("pendiente")}</div>`);
    if (abiertos) alertas.push(`<div class="item"><span class="dot" style="background:var(--violet)"></span><div class="item-main"><strong>${abiertos} pre-registro(s) necesitan seguimiento</strong><small>Podés preparar el mensaje de WhatsApp.</small></div>${badge("enviado")}</div>`);
    const fundadoresPendientes = solicitudes.filter((r) => r.datos_pendiente_revision).length;
    if (fundadoresPendientes) alertas.push(`<div class="item"><span class="dot" style="background:var(--orange)"></span><div class="item-main"><strong>${fundadoresPendientes} fundador(es) enviaron sus datos por el link</strong><small>Revisalos en Socios y confirmá su número de socio.</small></div><span class="badge pendiente">Por revisar</span></div>`);
    const aprobadosSinNumero = solicitudes.filter((r) => r.estado === "aprobado" && !r.numero_socio && !r.datos_pendiente_revision).length;
    if (aprobadosSinNumero) alertas.push(`<div class="item"><span class="dot" style="background:var(--green)"></span><div class="item-main"><strong>${aprobadosSinNumero} socio(s) sin número asignado</strong><small>Completá la resolución de admisión.</small></div>${badge("aprobado")}</div>`);
    $("#dashAlertas").innerHTML = alertas.join("") || '<div class="empty">Todo al día. No hay asuntos pendientes.</div>';
    const activityBox = $("#dashActivity");
    activityBox.innerHTML = actividad.slice(0, 4).map((a) => `<div class="item"><span class="dot" style="background:var(--green)"></span><div class="item-main"><strong>${esc(a.texto)}</strong><small>${fmtDate(a.fecha)} · ${esc(a.usuario || "Administrador")}</small></div></div>`).join("") || '<div class="empty">Todavía no hay actividad.</div>';
    $("#dashEstadoTitulo").textContent = pendientes || abiertos ? "Hay gestiones para revisar" : "La operación está al día";
    $("#dashEstadoNota").textContent = pendientes || abiertos ? `${pendientes} solicitudes y ${abiertos} contactos abiertos.` : "Registrá una solicitud o pre-registro para comenzar.";
    $("#dashPedidos").textContent = solicitudes.length;
    $("#bellBtn")?.classList.toggle("has-alert", pendientes + abiertos > 0);
  }

  function renderRequests() {
    const q = ($("#requestSearch").value || "").toLowerCase();
    const rows = solicitudes.filter((r) => (filter === "todos" || (filter === "observada" ? ["observada", "observado"].includes(r.estado) : r.estado === filter)) && `${nombre(r)} ${r.cedula || ""} ${r.numero_solicitud || ""}`.toLowerCase().includes(q));
    $("#requestsBody").innerHTML = rows.map((r) => `<tr><td>#${String(r.numero_solicitud || "—").padStart(4, "0")}</td><td><strong>${esc(nombre(r))}</strong></td><td>${esc(r.cedula || "—")}</td><td>${fmtDate(r.created_at)}</td><td>${badge(r.estado || "pendiente")}</td><td><button class="linkbtn" data-request="${esc(r.id)}">Ver detalle</button></td></tr>`).join("") || '<tr><td colspan="6" class="empty">No hay solicitudes en esta vista.</td></tr>';
    $$('[data-request]').forEach((b) => b.addEventListener("click", () => openRequest(b.dataset.request)));
  }

  function detail(label, value) { return `<div class="detail"><small>${esc(label)}</small><strong>${esc(value || "—")}</strong></div>`; }
  function openRequest(id) {
    const r = solicitudes.find((x) => String(x.id) === String(id)); if (!r) return;
    const beneficiaries = Array.isArray(r.beneficiarios) && r.beneficiarios.length ? r.beneficiarios.map((b) => `${b.nombre} (${b.parentesco || "—"}, ${b.porcentaje || 0}%)`).join(" · ") : "Sin beneficiarios";
    if (tipoSocio(r) === "fundador") {
      const pendiente = !!r.datos_pendiente_revision;
      modal(`Socio Fundador N.º ${r.numero_socio || "—"}${pendiente ? " · Pendiente de revisión" : ""}`, `${photoPickerHtml(r)}<div class="detailgrid">${detail("Nombre", nombre(r))}${detail("Cédula", r.cedula)}${detail("Nacimiento", fmtDate(r.fecha_nacimiento))}${detail("Celular", tel(r))}${detail("Correo", r.correo_electronico)}${detail("Ciudad", [r.ciudad, r.barrio].filter(Boolean).join(", "))}${detail("Dirección", r.direccion)}${detail("Actividad", r.condicion_laboral)}${detail("Origen de fondos", r.origen_fondos)}${detail("Certificados suscritos", (r.certificados_suscritos || 100) + " × Gs. 30.000")}${detail("Capital integrado (60%)", fmtGs(r.capital_integrado || Math.round((r.capital_suscrito || 3000000) * 0.6)))}${detail("Fecha de constitución", fmtDate(r.fecha_constitucion || FECHA_CONSTITUCION))}${detail("Beneficiarios", beneficiaries)}</div>${pendiente ? '<p style="color:var(--orange);font-size:12px;font-weight:700">Estos datos los completó el propio socio por el link público. Revisalos y confirmá el número de socio y el capital fundacional.</p>' : ""}<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;margin-top:16px">${tel(r) ? '<button class="btn btn-whatsapp" id="reqWhatsApp">WhatsApp</button>' : ""}<button class="btn btn-secondary" id="reqPrint">Imprimir ficha</button><button class="btn btn-primary" id="reqReview">${pendiente ? "Revisar y confirmar datos" : "Editar datos"}</button></div>`);
      wirePhotoPicker(r);
      if (tel(r)) $("#reqWhatsApp").onclick = () => shareMemberWhatsApp(r);
      $("#reqPrint").onclick = () => printRequest(r);
      $("#reqReview").onclick = () => {
        if (!pendiente && configInstitucional && configInstitucional.cierre_fundacional && !esSuperadmin()) {
          return toast("La nómina fundacional está cerrada: solo un superadministrador puede corregir datos de un fundador ya confirmado");
        }
        closeModal(); fundadorModal(r);
      };
      return;
    }
    if (r.estado === "aprobado") {
      modal(`Socio N.º ${r.numero_socio || "—"}`, `${photoPickerHtml(r)}<div class="detailgrid">${detail("Nombre", nombre(r))}${detail("Cédula", r.cedula)}${detail("Nacimiento", fmtDate(r.fecha_nacimiento))}${detail("Celular", tel(r))}${detail("Correo", r.correo_electronico)}${detail("Ciudad", [r.ciudad, r.departamento].filter(Boolean).join(", "))}${detail("Dirección", r.direccion)}${detail("Actividad", r.condicion_laboral)}${detail("Origen de fondos", r.origen_fondos)}${detail("N.º de resolución", r.resolucion_numero)}${detail("Fecha de admisión", fmtDate(r.fecha_revision))}${detail("Beneficiarios", beneficiaries)}</div><div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;margin-top:16px">${tel(r) ? '<button class="btn btn-whatsapp" id="reqWhatsApp">WhatsApp</button>' : ""}<button class="btn btn-secondary" id="reqContributions">Ver aportes</button><button class="btn btn-primary" id="reqPrint">Abrir carpeta del socio</button></div>`);
      wirePhotoPicker(r);
      if (tel(r)) $("#reqWhatsApp").onclick = () => shareMemberWhatsApp(r);
      $("#reqPrint").onclick = () => printRequest(r);
      $("#reqContributions").onclick = () => { closeModal(); go("aportes"); setTimeout(() => { const input = $("#opContributionSearch"); if (input) { input.value = r.cedula || r.numero_socio || nombre(r); input.dispatchEvent(new Event("input", { bubbles: true })); } }, 40); };
      return;
    }
    const canDeleteRequest = !supabaseClient || (perfilActual && ["superadministrador", "admision"].includes(perfilActual.rol));
    modal(`Solicitud #${r.numero_solicitud || "—"}`, `${photoPickerHtml(r)}<div class="detailgrid">${detail("Solicitante", nombre(r))}${detail("Cédula", r.cedula)}${detail("Nacimiento", fmtDate(r.fecha_nacimiento))}${detail("Celular", tel(r))}${detail("Contacto preferido", r.contacto_preferido)}${detail("Ciudad", [r.ciudad, r.departamento].filter(Boolean).join(", "))}${detail("Dirección", r.direccion)}${detail("Vivienda", r.tipo_vivienda)}${detail("Actividad", r.condicion_laboral)}${detail("Empresa / RUC", r.empresa_ruc)}${detail("Cargo", r.cargo_laboral)}${detail("Antigüedad laboral", r.antiguedad_laboral)}${detail("Dirección laboral", r.direccion_laboral)}${detail("Cargo público/político", r.cargo_publico)}${detail("Trabajo en ONG", r.trabajo_ong)}${detail("Origen de fondos", r.origen_fondos)}${detail("Referente", r.referente_nombre)}${detail("Forma de pago", r.forma_pago)}${detail("Derecho de admisión", fmtGs(r.derecho_admision || 150000))}${detail("Beneficiarios", beneficiaries)}</div><div class="formfield"><label>Notas administrativas</label><textarea id="requestNotes" rows="3" style="width:100%;border:1px solid var(--line);border-radius:12px;padding:10px">${esc(r.notas_admin || "")}</textarea></div><div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;margin-top:16px">${canDeleteRequest ? '<button class="btn" style="background:var(--danger);color:white;margin-right:auto" id="reqDelete">Eliminar solicitud</button>' : ""}<button class="btn btn-whatsapp" id="reqWhatsApp">WhatsApp</button><button class="btn btn-secondary" id="reqPrint">Imprimir ficha</button><button class="btn btn-secondary" id="reqObserve">Observar</button><button class="btn" style="background:var(--danger);color:white" id="reqReject">Rechazar</button><button class="btn btn-primary" id="reqApprove">Aprobar</button></div>`);
    wirePhotoPicker(r);
    $("#reqWhatsApp").onclick = () => shareMemberWhatsApp(r);
    $("#reqPrint").onclick = () => printRequest(r);
    $("#reqObserve").onclick = busyClick($("#reqObserve"), () => updateRequest(r, "observada"));
    $("#reqReject").onclick = busyClick($("#reqReject"), () => updateRequest(r, "rechazado"));
    $("#reqApprove").onclick = () => approveRequest(r);
    if ($("#reqDelete")) $("#reqDelete").onclick = () => removeRequest(r);
  }
  function requireProfileGuard() {
    if (supabaseClient && !puedeGestionar()) { toast("Tu rol (solo lectura) no permite hacer esto"); return false; }
    return true;
  }
  function shareMemberWhatsApp(r) {
    if (!tel(r)) return toast("El socio no tiene un número de WhatsApp");
    const msg=`Hola ${nombre(r)}, te enviamos tu ficha de la Cooperativa Cimientos${r.numero_socio?` (Socio N.º ${r.numero_socio})`:""}. En esta beta local, abrí primero “Imprimir ficha”, guardala como PDF y adjuntala a este chat.`;
    if (!abrirWhatsApp(tel(r), msg)) return;
    log(`Se preparó el envío de ficha por WhatsApp para ${nombre(r)}`);
  }
  async function removeRequest(r) {
    if (!requireProfileGuard()) return;
    const motivo = prompt(`Motivo para eliminar la solicitud de ${nombre(r)}:`);
    if (!motivo || !motivo.trim()) return toast("La eliminación requiere un motivo.");
    if (!confirm("Esta acción elimina una solicitud no admitida. La auditoría conservará quién la eliminó y el motivo. ¿Continuar?")) return;
    try {
      if (supabaseClient) {
        const { error } = await supabaseClient.rpc("fn_eliminar_solicitud", { p_id: r.id, p_motivo: motivo.trim() });
        if (error) throw error;
      }
      solicitudes = solicitudes.filter((item) => item.id !== r.id);
      write(KEYS.solicitudes, solicitudes);
      log(`${perfilActual ? perfilActual.nombre : config.administrador} eliminó la solicitud de ${nombre(r)}. Motivo: ${motivo.trim()}`);
      closeModal(); renderAll(); toast("Solicitud eliminada con auditoría");
    } catch (err) { toast(friendlyError(err, "No se pudo eliminar la solicitud")); }
  }
  async function updateRequest(r, estado) {
    if (!requireProfileGuard()) return;
    const motivo = $("#requestNotes").value.trim();
    const etiqueta = estado === "observada" ? "observar" : "rechazar";
    if (!motivo) { toast(`Escribí el motivo para ${etiqueta} antes de continuar`); $("#requestNotes").focus(); return; }
    if (!confirm(`¿Confirmás que querés ${etiqueta} la solicitud de ${nombre(r)}?`)) return;
    if (supabaseClient) {
      try {
        const { data, error } = await supabaseClient.rpc("fn_resolver_solicitud", { p_id: r.id, p_accion: estado, p_motivo: motivo });
        if (error) throw error;
        Object.assign(r, data);
        write(KEYS.solicitudes, solicitudes);
        log(`${perfilActual ? perfilActual.nombre : config.administrador} marcó como ${estado} la solicitud de ${nombre(r)}`);
        closeModal(); renderAll(); toast("Solicitud actualizada");
      } catch (err) { toast(friendlyError(err, "No se pudo actualizar la solicitud")); }
      return;
    }
    r.estado = estado; r.notas_admin = motivo; r.revisado_por = config.administrador; r.fecha_revision = now(); saveSolicitudes(r); log(`${config.administrador} marcó como ${estado} la solicitud de ${nombre(r)}`); closeModal(); renderAll(); toast("Solicitud actualizada");
  }
  function nextMemberNumber() {
    if (configInstitucional) return String(configInstitucional.proximo_numero_socio).padStart(4, "0");
    const used = solicitudes.map((r) => parseInt(r.numero_socio, 10)).filter(Number.isFinite); return String(Math.max(config.proximoSocio - 1, ...used, 0) + 1).padStart(4, "0");
  }
  function nextLocalResolutionNumber() {
    const year = String(new Date().getFullYear());
    const used = solicitudes.map((row) => String(row.resolucion_numero || "")).map((value) => {
      const match = value.match(/RES-(\d+)\/(\d{4})$/i);
      return match && match[2] === year ? Number(match[1]) : 0;
    });
    return `RES-${String(Math.max(0, ...used) + 1).padStart(4, "0")}/${year}`;
  }
  function approveRequest(r) {
    if (!requireProfileGuard()) return;
    const suggested = r.numero_socio || nextMemberNumber();
    const resolutionPreview = r.resolucion_numero || (supabaseClient ? `Automático · RES-0001/${new Date().getFullYear()}` : nextLocalResolutionNumber());
    modal("Aprobar solicitud", `<p style="color:var(--muted);font-size:12px">El número de socio y la resolución se asignan de forma automática y segura al confirmar. El servidor evita duplicados aunque dos funcionarios aprueben al mismo tiempo.</p><div class="formgrid"><div class="formfield"><label>Número de socio (sugerido)</label><input id="approveNumber" value="${esc(suggested)}" readonly></div><div class="formfield"><label>Número de resolución</label><input id="approveResolution" value="${esc(resolutionPreview)}" readonly><small style="display:block;color:var(--muted);font-size:9px;margin-top:5px">La numeración se reinicia cada año y el servidor confirma el valor definitivo.</small></div></div><div class="formfield" style="margin-top:12px"><label>Notas</label><textarea id="approveNotes" rows="3" style="width:100%;border:1px solid var(--line);border-radius:12px;padding:10px">${esc(r.notas_admin || "")}</textarea></div><div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px"><button class="btn btn-secondary" id="approveCancel">Cancelar</button><button class="btn btn-primary" id="approveConfirm">Confirmar admisión</button></div>`);
    $("#approveCancel").onclick = closeModal;
    $("#approveConfirm").onclick = busyClick($("#approveConfirm"), async () => {
      const resolucion = supabaseClient ? null : nextLocalResolutionNumber();
      const n = $("#approveNumber").value.trim();
      if (n && !/^\d+$/.test(n)) return toast("El número de socio debe contener solo números");
      const notas = $("#approveNotes").value.trim();
      if (!confirm(`¿Confirmás la admisión de ${nombre(r)}${n ? ` con el N.º de socio ${n.padStart(4, "0")}` : ""}?`)) return;
      if (supabaseClient) {
        try {
          const { data, error } = await supabaseClient.rpc("fn_aprobar_solicitud", { p_id: r.id, p_resolucion: null, p_numero_socio: null, p_notas: notas || null });
          if (error) throw error;
          Object.assign(r, data);
          write(KEYS.solicitudes, solicitudes);
          await cargarConfigInstitucional();
          log(`${perfilActual ? perfilActual.nombre : config.administrador} aprobó a ${nombre(r)} como socio N.º ${r.numero_socio}`);
          closeModal(); renderAll(); toast("Socio admitido");
        } catch (err) { toast(friendlyError(err, "No se pudo aprobar la solicitud")); }
        return;
      }
      if (!n) return toast("Ingresá el número de socio");
      if (solicitudes.some((x) => x !== r && x.numero_socio === n.padStart(4, "0"))) return toast("Ese número ya está asignado");
      r.estado = "aprobado"; r.numero_socio = n.padStart(4, "0"); r.resolucion_numero = resolucion; r.notas_admin = notas; r.revisado_por = config.administrador; r.fecha_revision = now(); config.proximoSocio = Math.max(config.proximoSocio, parseInt(n, 10) + 1); write(KEYS.config, config); saveSolicitudes(r); log(`${config.administrador} aprobó a ${nombre(r)} como socio N.º ${r.numero_socio}`); closeModal(); renderAll(); toast("Socio admitido");
    });
  }

  function printRequest(r) {
    const w = window.open("", "_blank", "width=820,height=900");
    if (!w) return toast("El navegador bloqueó la ventana de impresión. Habilitá los pop-ups para este sitio.");
    w.document.write(memberPrintHtml(r));
    w.document.close();
  }

  function memberPrintHtml(r) {
    const field = (label, value) => value ? `<div class="f"><small>${esc(label)}</small><strong>${esc(value)}</strong></div>` : "";
    const fieldAlways = (label, value) => `<div class="f"><small>${esc(label)}</small><strong>${esc(value || "—")}</strong></div>`;
    const beneficiaries = Array.isArray(r.beneficiarios) && r.beneficiarios.length
      ? r.beneficiarios.map((b) => `<div class="f"><small>${esc(b.parentesco || "Beneficiario")}</small><strong>${esc(b.nombre)} — C.I. ${esc(b.cedula || "—")} (${esc(String(b.porcentaje || "—"))}%)</strong></div>`).join("")
      : `<p class="muted-note">Sin beneficiarios designados.</p>`;
    const admitted = r.estado === "aprobado";
    const esFundador = tipoSocio(r) === "fundador";
    const phone = String(tel(r) || "").replace(/\D/g, "").replace(/^0/, "595");
    const waMessage = `Hola ${nombre(r)}, te enviamos tu ficha de socio de la Cooperativa Cimientos${r.numero_socio ? ` N.º ${r.numero_socio}` : ""}.`;
    const numeroSocio = r.numero_socio || "—";
    const numeroSolicitud = "0001-" + String(r.numero_solicitud || 0).padStart(4, "0");
    const docCode = "FIC-" + (r.numero_socio || "SOL" + String(r.numero_solicitud || 0).padStart(4, "0"));
    const printLogo = new URL("assets/logo-cimientos.png", location.href).href;

    const watermark = admitted ? "" : `<div class="watermark">${r.estado === "rechazado" ? "SOLICITUD RECHAZADA" : "EN REVISIÓN"}</div>`;

    const masthead = (tipo) => `
      <header class="mh">
        <div class="mh-brand">
          <img class="mh-mark" src="${printLogo}" alt="Cooperativa Cimientos Ltda.">
          <span class="mh-contact">+595 974 635630<br>cooperativacimientosltda2026@gmail.com</span>
        </div>
        <div class="mh-doc"><span class="mh-tag">${esc(tipo)}</span></div>
      </header>`;

    const pageFooter = (codigo) => `
      <footer class="pf">
        <span>Documento interno · Cooperativa Cimientos Ltda.</span>
        <span>${esc(codigo)} · C.I. ${esc(r.cedula || "—")}</span>
      </footer>`;

    const identityLine = [
      admitted ? `Socio N° ${numeroSocio}` : "Sin número asignado",
      ...(esFundador
        ? ["Socio Fundador", `Socio desde la constitución — ${fmtDate(r.fecha_constitucion || FECHA_CONSTITUCION)}`]
        : [`Solicitud N° ${numeroSolicitud}`, admitted ? `Admitido el ${fmtDate(r.fecha_revision)}` : `Ingresada el ${fmtDate(r.created_at)}`]),
    ].map(esc).join(" · ");

    const ficha = `
      <article class="paper">
        ${watermark}
        ${masthead("Ficha de Socio")}
        <div class="identity">
          <h1>${esc(nombre(r))}</h1>
          <p class="identity-line">${identityLine}</p>
        </div>
        <section><h2>Datos personales</h2><div class="grid">
          ${field("Cédula de identidad", r.cedula)}${field("Nacionalidad", r.nacionalidad)}
          ${field("Fecha de nacimiento", fmtDate(r.fecha_nacimiento))}${field("Estado civil", r.estado_civil)}
          ${field("Profesión / oficio", r.profesion_oficio)}${field("Género", r.genero)}
        </div></section>
        <section><h2>Domicilio y contacto</h2><div class="grid">
          ${field("Ciudad", r.ciudad)}${field("Barrio", r.barrio)}
          ${field("Dirección", r.direccion)}${field("Celular / WhatsApp", tel(r))}
          ${field("Correo electrónico", r.correo_electronico)}${field("Tipo de vivienda", r.tipo_vivienda)}
        </div></section>
        <section><h2>Actividad económica (SEPRELAD)</h2><div class="grid">
          ${field("Condición laboral", r.condicion_laboral)}${field("Empresa / RUC", r.empresa_ruc)}
          ${field("Cargo / función", r.cargo_laboral)}${field("Antigüedad", r.antiguedad_laboral)}
          ${field("Origen de fondos declarado", r.origen_fondos)}${field("Cargo público / político", r.cargo_publico)}
        </div></section>
        ${esFundador
          ? `<section><h2>Capital fundacional (Art. 8° inc. f)</h2><div class="grid">
          ${field("Certificados suscritos", (r.certificados_suscritos || 100) + " × Gs. 30.000")}${field("Capital suscrito total", fmtGs(r.capital_suscrito || (r.certificados_suscritos || 100) * 30000))}
          ${field("Integrado en la asamblea constitutiva (60%)", fmtGs(r.capital_integrado || Math.round((r.capital_suscrito || 3000000) * 0.6)))}${field("Cuotas del saldo (40%) pagadas", (r.cuotas_saldo_pagadas != null ? r.cuotas_saldo_pagadas : 6) + " de 6")}
        </div></section>`
          : `<section><h2>Aportes y capital</h2><div class="grid">
          ${field("Derecho de admisión", fmtGs(r.derecho_admision || 150000))}${field("Cuotas partes adelantadas", r.cuotas_partes)}
          ${field("Adelanto de aporte inicial", r.monto_adelanto ? fmtGs(r.monto_adelanto) : "")}${field("Forma de pago", r.forma_pago)}
        </div></section>`}
        ${esFundador ? "" : `<section><h2>Socio referente</h2><div class="grid">
          ${field("Socio referente", r.referente_nombre || "Lo asigna el Consejo")}${field("Cédula del referente", r.referente_cedula)}
        </div></section>`}
        <section class="tight"><h2>Beneficiarios</h2><div class="grid">
          ${beneficiaries}
        </div></section>
        ${pageFooter(docCode)}
      </article>`;

    const resolutionCode = "RES-" + (r.resolucion_numero || numeroSocio);
    const resolution = admitted ? `
      <article class="paper">
        ${masthead("Resolución del Consejo")}
        <div class="identity">
          <h1>Resolución del Consejo de Administración</h1>
          <p class="identity-line">Registro de la decisión de admisión y asignación de número de socio</p>
        </div>
        <section><h2>Datos de la resolución</h2><div class="grid">
          ${fieldAlways("N.º de socio asignado", numeroSocio)}${fieldAlways("N.º de resolución", r.resolucion_numero)}
          ${fieldAlways("Socio", nombre(r))}${fieldAlways("Cédula de identidad", r.cedula)}
          ${fieldAlways("Revisado por", r.revisado_por)}${fieldAlways(esFundador ? "Fecha de constitución" : "Fecha de sesión", fmtDate(esFundador ? (r.fecha_constitucion || FECHA_CONSTITUCION) : r.fecha_revision))}
        </div></section>
        <section><h2>Decisión</h2><p class="resolution-text">${esFundador ? "Se deja registrada la calidad de socio fundador conforme al Acta de la Asamblea Constitutiva y al Estatuto Social." : "El Consejo de Administración resolvió admitir a la persona identificada en este documento como socio/a ordinario/a de la Cooperativa Cimientos Ltda., conforme al Art. 12° del Estatuto Social."}</p></section>
        <div class="sign-row resolution-signs">
          <div class="sign-box"><div class="sign-line"></div><span>Firma del socio — ${esc(nombre(r))}</span></div>
          <div class="sign-box"><div class="sign-line"></div><span>Firma y sello — Presidencia del Consejo</span></div>
        </div>
        <p class="legal-note">Declaro bajo fe de juramento que los datos consignados son veraces (SEPRELAD) y que acepto el Estatuto Social, sus reglamentos y las resoluciones de los órganos de la Cooperativa.</p>
        ${pageFooter(resolutionCode)}
      </article>` : "";

    const constanciaCode = "CON-" + (r.numero_socio || "—");
    const constancia = admitted ? `
      <article class="paper">
        ${masthead(esFundador ? "Constancia de Socio Fundador" : "Constancia de Admisión")}
        <div class="cert">
          <span class="cert-eyebrow">Consejo de Administración</span>
          <h1>${esFundador ? "Constancia de Socio Fundador" : "Constancia de Admisión de Socio"}</h1>
          <div class="cert-rule"></div>
          ${esFundador
            ? `<p>El Consejo de Administración de la Cooperativa Multiactiva de Ahorro, Crédito, Construcción, Industria y Servicios Varios &ldquo;Cimientos&rdquo; Limitada certifica que <strong>${esc(nombre(r))}</strong>, con Cédula de Identidad N° <strong>${esc(r.cedula || "—")}</strong>, reviste la calidad de <span class="cert-num">Socio Fundador</span> bajo el N° de Socio ${esc(numeroSocio)}, por haber suscripto e integrado el capital fundacional conforme al Acta de la Asamblea Constitutiva de fecha ${esc(fmtDate(r.fecha_constitucion || FECHA_CONSTITUCION))}, de conformidad con el Art. 8° inc. f del Estatuto Social.</p>
          <p>Se deja constancia de que el/la socio/a fundador/a queda sujeto/a al cumplimiento del Estatuto Social, sus Reglamentos internos y las resoluciones de los órganos de la Cooperativa, gozando desde esta fecha de los derechos establecidos en el Art. 13° del mismo Estatuto.</p>`
            : `<p>El Consejo de Administración de la Cooperativa Multiactiva de Ahorro, Crédito, Construcción, Industria y Servicios Varios &ldquo;Cimientos&rdquo; Limitada certifica que <strong>${esc(nombre(r))}</strong>, con Cédula de Identidad N° <strong>${esc(r.cedula || "—")}</strong>, ha sido admitido/a como socio/a ordinario/a de la cooperativa bajo el <span class="cert-num">N° de Socio ${esc(numeroSocio)}</span>, en sesión del Consejo de Administración de fecha ${esc(fmtDate(r.fecha_revision))}, de conformidad con el Art. 12° del Estatuto Social.</p>
          <p>Se deja constancia de que el/la socio/a queda sujeto/a al cumplimiento del Estatuto Social, sus Reglamentos internos y las resoluciones de los órganos de la Cooperativa, gozando desde esta fecha de los derechos establecidos en el Art. 13° del mismo Estatuto.</p>`}
        </div>
        <div class="sign-row">
          <div class="sign-box"><div class="sign-line"></div><span>Presidente — Consejo de Administración</span></div>
          <div class="sign-box"><div class="sign-line"></div><span>Secretario — Consejo de Administración</span></div>
        </div>
        ${pageFooter(constanciaCode)}
      </article>` : "";

    const reciboCode = "REC-" + (r.numero_socio || "SOL" + String(r.numero_solicitud || 0).padStart(4, "0")) + "-" + esc(r.recibo_numero || "—");
    const total = (Number(r.derecho_admision) || 150000) + (Number(r.monto_adelanto) || 0);
    const receipt = r.pago_confirmado ? `
      <article class="paper">
        ${masthead("Comprobante de Pago")}
        <div class="identity tight">
          <h1>Recibo de aportes de admisión</h1>
          <p class="identity-line">${[`Recibo N° ${r.recibo_numero || "—"}`, fmtDate(r.fecha_pago || now())].map(esc).join(" · ")}</p>
        </div>
        <div class="receipt-box">
          <div class="grid">
            ${field("Recibí de", nombre(r))}${field("Cédula de identidad", r.cedula)}
            ${field("Socio N°", r.numero_socio)}${field("Forma de pago", r.forma_pago)}
            ${field("Derecho de admisión (Art. 8° inc. c, no reembolsable)", fmtGs(r.derecho_admision || 150000))}${field("Adelanto de aporte declarado", fmtGs(r.monto_adelanto || 0))}
          </div>
          <div class="total-row"><span>Total recibido</span><strong>${fmtGs(total)}</strong></div>
        </div>
        <div class="sign-row">
          <div class="sign-box"><div class="sign-line"></div><span>Firma del socio</span></div>
          <div class="sign-box"><div class="sign-line"></div><span>Firma y sello — Tesorería</span></div>
        </div>
        <p class="legal-note">El derecho de admisión es una tasa única y no reembolsable, fijada por el Consejo de Administración conforme al Art. 8° inc. c del Estatuto Social. A partir de la admisión rige el aporte mensual obligatorio del Art. 8° inc. g (Gs. 50.000: Gs. 30.000 a certificados de aportación + Gs. 20.000 al Fondo de Solidaridad).</p>
        ${pageFooter(reciboCode)}
      </article>` : "";

    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Ficha de socio — ${esc(nombre(r))}</title>
      <link rel="stylesheet" href="fonts.css">
      <style>
        @page{size:A4;margin:0}
        *{box-sizing:border-box}
        body{margin:0;background:#dfe3dc;color:#1c1e1c;font-family:"Nunito Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
        .paper{position:relative;width:210mm;min-height:297mm;margin:12px auto;background:#fff;padding:15mm 16mm 14mm;page-break-after:always;overflow:hidden;box-shadow:0 4px 22px rgba(20,25,15,.12)}
        .paper:last-of-type{page-break-after:auto}
        .watermark{position:absolute;top:46%;left:50%;transform:translate(-50%,-50%) rotate(-24deg);font-size:52px;font-weight:800;letter-spacing:.08em;color:rgba(194,59,43,.09);white-space:nowrap;pointer-events:none;z-index:0}
        .mh{position:relative;z-index:1;display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #1c1e1c;padding-bottom:5mm;margin-bottom:5mm}
        .mh-brand{display:flex;gap:11px;align-items:center}
        .mh-mark{height:31px;width:auto;max-width:70mm;display:block;object-fit:contain}
        .mh-contact{font-size:7px;line-height:1.45;color:#8a8f89;border-left:1px solid #e1e4dd;padding-left:10px}
        .mh-name strong{display:block;font-size:12px;letter-spacing:.01em}
        .mh-name span{display:block;font-size:7.5px;color:#767b73;max-width:60mm;line-height:1.35;margin-top:2px}
        .mh-doc{text-align:right}
        .mh-tag{display:inline-block;background:#eef4e3;color:#4f8217;font-size:9px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;padding:3px 8px;border-radius:999px}
        .identity{position:relative;z-index:1;padding-bottom:3.5mm}
        .identity.tight{padding-bottom:5mm}
        .identity h1{margin:0 0 4px;font-size:19px;letter-spacing:-.02em}
        .identity-line{margin:0;font-size:10.5px;color:#5a5f58;font-weight:600}
        section{position:relative;z-index:1;padding:2.6mm 0;border-bottom:1px solid #e4e6e0;break-inside:avoid}
        section.tight{padding-bottom:2mm}
        section h2{font-size:9.5px;text-transform:uppercase;letter-spacing:.08em;color:#4f8217;margin:0 0 2.4mm;font-weight:800}
        .grid{display:grid;grid-template-columns:1fr 1fr;column-gap:9mm;row-gap:2.2mm}
        .f{break-inside:avoid}
        .f small{display:block;color:#8a8f89;font-size:7.3px;text-transform:uppercase;letter-spacing:.06em;margin-bottom:1px}
        .f strong{display:block;font-size:10px;font-weight:650;padding-bottom:1.4mm;border-bottom:1px solid #e9ebe6}
        .muted-note{grid-column:1/-1;color:#8a8f89;font-size:9.5px;margin:0}
        .sign-row{position:relative;z-index:1;display:grid;grid-template-columns:1fr 1fr;gap:16mm;margin-top:20mm}
        .sign-row.compact{margin-top:8mm}
        .sign-box{text-align:center}
        .sign-img{max-height:16mm;max-width:100%;display:block;margin:0 auto 2mm}
        .sign-line{border-top:1px solid #1c1e1c;padding-top:0}
        .sign-box span{display:block;margin-top:4px;font-size:9px;color:#767b73}
        .receipt-box{position:relative;z-index:1;border:1.5px solid #1c1e1c;border-radius:11px;padding:7mm 8mm;margin-top:2mm}
        .total-row{display:flex;justify-content:space-between;align-items:baseline;border-top:1.5px dashed #c9cdc2;margin-top:6mm;padding-top:5mm}
        .total-row span{font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:#5a5f58;font-weight:700}
        .total-row strong{font-size:19px;font-weight:800;color:#4f8217;font-variant-numeric:tabular-nums}
        .legal-note{position:relative;z-index:1;font-size:9px;line-height:1.6;color:#767b73;margin-top:10mm}
        .cert{position:relative;z-index:1;max-width:150mm;margin:14mm auto 0;text-align:center}
        .cert-eyebrow{display:block;font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#4f8217}
        .cert h1{font-family:"Nunito Sans",sans-serif;font-size:25px;font-weight:800;margin:6px 0 8px}
        .cert-rule{width:44px;height:2px;background:#6a9c20;margin:0 auto 12mm}
        .cert p{font-family:"Nunito Sans",sans-serif;font-size:13px;line-height:1.85;text-align:left;margin:0 0 6mm;color:#26281f}
        .resolution-text{font-size:12px;line-height:1.75;margin:0;max-width:164mm}
        .resolution-signs{margin-top:34mm}
        .cert-num{font-weight:700;color:#4f8217}
        .checklist{position:relative;z-index:1;max-width:150mm;margin:16mm auto 0;border-top:1px solid #e4e6e0;padding-top:6mm;font-size:9.5px;color:#5a5f58}
        .checklist strong{display:block;margin-bottom:2mm;color:#26281f;font-size:10px}
        .checklist ul{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:1.6mm}
        .pf{position:absolute;left:16mm;right:16mm;bottom:9mm;display:flex;justify-content:space-between;border-top:1px solid #e4e6e0;padding-top:2.5mm;font-size:7.5px;color:#9a9e96;z-index:1}
        .actions{position:fixed;right:18px;bottom:18px;display:flex;gap:8px;z-index:9}
        .actions button{border:0;border-radius:12px;padding:11px 16px;font-weight:750;font-family:inherit;font-size:13px;cursor:pointer}
        .print{background:#4f8217;color:#fff;box-shadow:0 8px 20px rgba(79,130,23,.32)}
        .whatsapp{background:#25D366;color:#fff}
        .close{background:#fff;border:1px solid #d7dad3!important}
        .hint{position:fixed;left:18px;bottom:18px;font-size:11px;color:#5a5f58;background:#fff;padding:8px 12px;border-radius:10px;border:1px solid #d7dad3;max-width:280px;z-index:9}
        @media print{body{background:#fff}.paper{margin:0;box-shadow:none}.actions,.hint{display:none}}
      </style></head>
      <body>${ficha}${receipt}${resolution}${constancia}
      <div class="hint">Antes de imprimir: en el diálogo de impresión desactivá "Encabezados y pies de página" para que no aparezcan la URL y la fecha del navegador.</div>
      <div class="actions">${phone ? `<button class="whatsapp" onclick="this.disabled=true;open('https://web.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(waMessage)}','_blank','noopener,noreferrer');setTimeout(()=>this.disabled=false,1500)">WhatsApp</button>` : ""}<button class="close" onclick="close()">Cerrar</button><button class="print" onclick="print()">Imprimir / Guardar PDF</button></div>
      </body></html>`;
  }

  function renderLeads() {
    $("#leadsBody").innerHTML = leads.map((r) => `<tr><td><strong>${esc(r.nombre_contacto)}</strong></td><td>${esc(r.celular_whatsapp)}</td><td>${esc(r.origen || "Otro")}</td><td>${fmtDate(r.created_at)}</td><td>${badge(leadEstadoEfectivo(r))}</td><td><button class="linkbtn" data-lead="${esc(r.id)}">Gestionar</button></td></tr>`).join("") || '<tr><td colspan="6" class="empty">No hay pre-registros. Creá el primero cuando recibas una consulta.</td></tr>';
    $$('[data-lead]').forEach((b) => b.onclick = () => openLead(b.dataset.lead));
  }
  function openLead(id) { const r = leads.find((x) => String(x.id) === String(id)); if (!r) return; leadModal(r); }
  function leadModal(r) {
    const isNew = !r;
    modal(isNew ? "Nuevo pre-registro" : "Gestionar pre-registro", `<div class="formgrid"><div class="formfield"><label>Nombre y apellido</label><input id="leadName" value="${esc(r?.nombre_contacto || "")}"></div><div class="formfield"><label>Celular / WhatsApp</label><input id="leadPhone" value="${esc(r?.celular_whatsapp || "")}"></div><div class="formfield"><label>Origen</label><select id="leadOrigin"><option>Presencial</option><option>WhatsApp</option><option>Llamada</option><option>Referido</option><option>Otro</option></select></div><div class="formfield"><label>Estado${isNew ? "" : ` <span style="font-weight:400;text-transform:none;letter-spacing:0">— actual: ${badge(leadEstadoEfectivo(r))}</span>`}</label><select id="leadStatus"><option value="pendiente">Pendiente</option><option value="preparado">Link preparado</option><option value="copiado">Link copiado</option><option value="enviado">Enviado por WhatsApp</option><option value="iniciado">Formulario iniciado</option><option value="completado">Completado</option><option value="vencido">Token vencido</option><option value="revocado">Revocado</option><option value="descartado">Descartado</option></select></div></div><div class="formfield" style="margin-top:12px"><label>Notas</label><textarea id="leadNotes" rows="3" style="width:100%;border:1px solid var(--line);border-radius:12px;padding:10px">${esc(r?.notas || "")}</textarea></div><div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:16px">${isNew ? "" : '<button class="btn" style="background:var(--danger);color:white" id="leadDelete">Eliminar</button>' + (r.token && !["completado", "descartado", "revocado"].includes(r.estado) ? '<button class="btn btn-secondary" id="leadRevoke" style="color:var(--danger)">Revocar link</button>' : "") + '<button class="btn btn-secondary" id="leadCopyLink">Copiar link</button><button class="btn btn-secondary" id="leadWhatsApp">Preparar WhatsApp</button>'}<button class="btn btn-primary" id="leadSave">Guardar</button></div>`);
    $("#leadOrigin").value = r?.origen || "Presencial"; $("#leadStatus").value = r?.estado || "pendiente";
    $("#leadSave").onclick = () => { const name = $("#leadName").value.trim(), phone = $("#leadPhone").value.trim(); if (!name || !phone) return toast("Completá nombre y celular"); if (isNew) { r = { id: "lead-" + Date.now(), created_at: now() }; leads.unshift(r); } Object.assign(r, { nombre_contacto: name, celular_whatsapp: phone, origen: $("#leadOrigin").value, estado: $("#leadStatus").value, notas: $("#leadNotes").value.trim(), creado_por: config.administrador }); saveLeads(r); log(`${config.administrador} ${isNew ? "creó" : "actualizó"} el pre-registro de ${name}`); closeModal(); renderAll(); toast("Pre-registro guardado"); };
    if (!isNew) {
      $("#leadDelete").onclick = () => { if (!confirm("¿Eliminar este pre-registro?")) return; deleteRemote(TABLES.leads, r.id); leads = leads.filter((x) => x !== r); saveLeads(); log(`${config.administrador} eliminó el pre-registro de ${r.nombre_contacto}`); closeModal(); renderAll(); };
      if ($("#leadRevoke")) $("#leadRevoke").onclick = busyClick($("#leadRevoke"), () => revocarToken(r));
      // El link nunca lleva nombre ni celular en la URL: se genera un
      // token opaco y temporal en el servidor (fn_generar_token_preregistro)
      // que el formulario público resuelve del lado del servidor. Solo se
      // marca "preparado" — abrir WhatsApp o copiar el link no confirma
      // que la persona lo haya recibido ni completado.
      async function prepararLink() {
        const base = siteBase();
        if (!base) {
          toast("No se pudo armar el link: abrí el panel desde su dirección web real (https://…), no como archivo local.");
          return null;
        }
        if (supabaseClient) {
          try {
            const { data: token, error } = await supabaseClient.rpc("fn_generar_token_preregistro", { p_id: r.id });
            if (error) throw error;
            r.token = token; r.estado = "preparado";
            write(KEYS.leads, leads);
            log(`Se preparó el enlace de admisión para ${r.nombre_contacto}`);
            renderAll();
            return base + "/formulario.html?v=20260901-2&pre=" + encodeURIComponent(token);
          } catch (err) { toast(friendlyError(err, "No se pudo generar el enlace")); return null; }
        }
        // Sin Supabase configurado: no hay dónde resolver un token server-side,
        // así que el link cae de vuelta al formulario sin datos personales
        // en la URL (la persona completa su nombre/celular a mano).
        r.estado = "preparado"; saveLeads(r); renderAll();
        return base + "/formulario.html?v=20260901-2";
      }
      $("#leadCopyLink").onclick = busyClick($("#leadCopyLink"), async () => {
        const link = await prepararLink(); if (!link) return;
        // prepararLink() ya hizo renderAll() (recarga "leads" desde
        // localStorage), así que "r" quedó apuntando a un objeto viejo que
        // ya no es parte del array — hay que volver a buscarlo por id antes
        // de seguir modificándolo, si no el siguiente saveLeads pisa el
        // cambio de estado con la versión vieja.
        r = leads.find((x) => String(x.id) === String(r.id)) || r;
        navigator.clipboard?.writeText(link).then(() => toast("Link copiado")).catch(() => toast(link));
        avanzarEstadoLead(r, "copiado"); saveLeads(r); renderAll();
      });
      $("#leadWhatsApp").classList.add("btn-whatsapp");
      $("#leadWhatsApp").onclick = busyClick($("#leadWhatsApp"), async () => {
        const link = await prepararLink(); if (!link) return;
        r = leads.find((x) => String(x.id) === String(r.id)) || r;
        const msg = (config.mensajeInvitacion || "Hola {nombre}, te compartimos el formulario de admisión: {link}").replaceAll("{nombre}", r.nombre_contacto).replaceAll("{link}", link);
        if (!abrirWhatsApp(r.celular_whatsapp, msg)) return;
        avanzarEstadoLead(r, "enviado"); saveLeads(r);
        closeModal(); renderAll();
      });
    }
  }

  function fundadorModal(prefill) {
    const p = prefill || {};
    modal(p.id ? "Revisar socio fundador" : "Agregar socio fundador", `<p style="color:var(--muted);font-size:12px">Alta directa: los socios fundadores ya integran la Cooperativa desde el Acta de Asamblea Constitutiva, no pasan por una solicitud de admisión.${p.datos_pendiente_revision ? " Estos datos los completó el propio socio por el link público — revisalos antes de guardar." : ""}</p>
      <div class="formgrid">
        <div class="formfield"><label>Nombre y apellido</label><input id="fName" value="${esc(p.apellidos_nombres || "")}"></div>
        <div class="formfield"><label>Cédula de identidad</label><input id="fCedula" value="${esc(p.cedula || "")}"></div>
        <div class="formfield"><label>Nacionalidad</label><input id="fNac" value="${esc(p.nacionalidad || "Paraguaya")}"></div>
        <div class="formfield"><label>Fecha de nacimiento</label><input id="fNacim" type="date" value="${esc(p.fecha_nacimiento || "")}"></div>
        <div class="formfield"><label>Estado civil</label><input id="fCivil" value="${esc(p.estado_civil || "")}"></div>
        <div class="formfield"><label>Profesión / oficio</label><input id="fProf" value="${esc(p.profesion_oficio || "")}"></div>
        <div class="formfield"><label>Ciudad</label><input id="fCiudad" value="${esc(p.ciudad || "")}"></div>
        <div class="formfield"><label>Barrio</label><input id="fBarrio" value="${esc(p.barrio || "")}"></div>
        <div class="formfield"><label>Dirección</label><input id="fDireccion" value="${esc(p.direccion || "")}"></div>
        <div class="formfield"><label>Celular / WhatsApp</label><input id="fCelular" value="${esc(p.celular_whatsapp || "")}"></div>
        <div class="formfield"><label>Correo electrónico</label><input id="fCorreo" type="email" value="${esc(p.correo || "")}"></div>
        <div class="formfield"><label>Número de socio</label><input id="fNumero" value="${esc(p.numero_socio || nextMemberNumber())}"></div>
      </div>
      <p style="color:var(--muted);font-size:12px;margin-top:14px">Actividad económica (SEPRELAD)</p>
      <div class="formgrid">
        <div class="formfield"><label>Condición laboral</label><input id="fCondicion" value="${esc(p.condicion_laboral || "")}"></div>
        <div class="formfield"><label>Empresa / RUC</label><input id="fEmpresa" value="${esc(p.empresa_ruc || "")}"></div>
        <div class="formfield"><label>Cargo / función</label><input id="fCargo" value="${esc(p.cargo_laboral || "")}"></div>
        <div class="formfield"><label>Antigüedad</label><input id="fAntiguedad" value="${esc(p.antiguedad_laboral || "")}"></div>
        <div class="formfield"><label>Origen de fondos</label><input id="fOrigen" value="${esc(p.origen_fondos || "")}"></div>
        <div class="formfield"><label>Cargo público / político</label><select id="fCargoPublico"><option value="No"${p.cargo_publico !== "Sí" ? " selected" : ""}>No</option><option value="Sí"${p.cargo_publico === "Sí" ? " selected" : ""}>Sí</option></select></div>
      </div>
      <p style="color:var(--muted);font-size:12px;margin-top:14px">Capital fundacional (Art. 8° inc. f del Estatuto — 100 certificados de Gs. 30.000 c/u)</p>
      <div class="formgrid">
        <div class="formfield"><label>Certificados suscritos</label><input id="fCert" type="number" min="100" value="${esc(p.certificados_suscritos || 100)}"></div>
        <div class="formfield"><label>Fecha de constitución</label><input id="fFechaConst" type="date" value="${esc(p.fecha_constitucion || FECHA_CONSTITUCION)}"></div>
        <div class="formfield"><label>Cuotas del saldo (40%) ya pagadas — de 6</label><input id="fCuotas" type="number" min="0" max="6" value="${p.cuotas_saldo_pagadas != null ? esc(p.cuotas_saldo_pagadas) : 6}"></div>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px"><button class="btn btn-secondary" id="fCancel">Cancelar</button><button class="btn btn-primary" id="fSave">Guardar fundador</button></div>`);
    $("#fCancel").onclick = closeModal;
    $("#fSave").onclick = () => {
      const nombreVal = $("#fName").value.trim();
      const cedula = $("#fCedula").value.trim();
      const numero = $("#fNumero").value.trim();
      if (!nombreVal || !cedula) return toast("Completá nombre y cédula");
      if (!numero || !/^\d+$/.test(numero)) return toast("El número de socio debe ser numérico");
      const numeroPad = numero.padStart(4, "0");
      const existente = p.id ? solicitudes.find((x) => x.id === p.id) : null;
      if (solicitudes.some((x) => x !== existente && x.numero_socio === numeroPad)) return toast("Ese número de socio ya está asignado");
      const certificados = Math.max(100, parseInt($("#fCert").value, 10) || 100);
      const capitalSuscrito = certificados * 30000;
      const capitalIntegrado60 = Math.round(capitalSuscrito * 0.6);
      const fechaConst = $("#fFechaConst").value || FECHA_CONSTITUCION;
      const datos = {
        tipo_socio: "fundador",
        apellidos_nombres: nombreVal, cedula,
        nacionalidad: $("#fNac").value.trim() || "Paraguaya",
        fecha_nacimiento: $("#fNacim").value, estado_civil: $("#fCivil").value.trim(),
        profesion_oficio: $("#fProf").value.trim(),
        ciudad: $("#fCiudad").value.trim(), barrio: $("#fBarrio").value.trim(), direccion: $("#fDireccion").value.trim(),
        celular_whatsapp: $("#fCelular").value.trim(), correo_electronico: $("#fCorreo").value.trim(),
        condicion_laboral: $("#fCondicion").value.trim(), empresa_ruc: $("#fEmpresa").value.trim(),
        cargo_laboral: $("#fCargo").value.trim(), antiguedad_laboral: $("#fAntiguedad").value.trim(),
        origen_fondos: $("#fOrigen").value.trim(), cargo_publico: $("#fCargoPublico").value,
        numero_socio: numeroPad, estado: "aprobado",
        certificados_suscritos: certificados, capital_suscrito: capitalSuscrito, capital_integrado: capitalIntegrado60,
        cuotas_saldo_pagadas: Math.min(6, Math.max(0, parseInt($("#fCuotas").value, 10) || 0)),
        fecha_constitucion: fechaConst,
        created_at: p.created_at || fechaConst, fecha_revision: fechaConst,
        revisado_por: config.administrador,
        beneficiarios: p.beneficiarios || [], referente_nombre: "", referente_cedula: "",
        pago_confirmado: false, datos_pendiente_revision: false,
      };
      let registro;
      if (existente) { Object.assign(existente, datos); registro = existente; }
      else { registro = Object.assign({ id: "fund-" + Date.now() }, datos); solicitudes.unshift(registro); }
      config.proximoSocio = Math.max(config.proximoSocio, parseInt(numero, 10) + 1);
      write(KEYS.config, config);
      saveSolicitudes(registro);
      log(`${config.administrador} ${existente ? "actualizó" : "agregó"} a ${nombreVal} como socio fundador N.º ${numeroPad}`);
      closeModal(); renderAll(); toast(existente ? "Fundador actualizado" : "Socio fundador agregado");
    };
  }

  function renderMembers() {
    const q = ($("#memberSearch").value || "").toLowerCase();
    const rows = solicitudes.filter((r) => r.estado === "aprobado" && (memberFilter === "todos" || tipoSocio(r) === memberFilter) && `${nombre(r)} ${r.cedula || ""} ${r.numero_socio || ""}`.toLowerCase().includes(q));
    $("#membersBody").innerHTML = rows.map((r) => `<tr><td><strong>${esc(r.numero_socio || "s/n")}</strong></td><td><strong>${esc(nombre(r))}</strong>${tipoSocio(r) === "fundador" ? ' <span style="color:var(--green);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em">· Fundador</span>' : ""}</td><td>${esc(r.cedula || "—")}</td><td>${fmtDate(r.fecha_revision || r.created_at)}</td><td>${r.datos_pendiente_revision ? '<span class="badge pendiente">Por revisar</span>' : badge("activo")}</td><td><button class="linkbtn" data-member="${esc(r.id)}">Abrir ficha</button></td></tr>`).join("") || '<tr><td colspan="6" class="empty">Todavía no hay socios aprobados.</td></tr>';
    $$('[data-member]').forEach((b) => b.onclick = () => openRequest(b.dataset.member));
  }
  function renderActivity() { $("#activityList").innerHTML = actividad.map((a) => `<div class="item"><span class="dot" style="background:var(--green)"></span><div class="item-main"><strong>${esc(a.texto)}</strong><small>${fmtDate(a.fecha)} · ${esc(a.usuario || "Administrador")}</small></div></div>`).join("") || '<div class="empty">Todavía no hay actividad registrada.</div>'; }
  function renderAll() { solicitudes = read(KEYS.solicitudes, solicitudes); leads = read(KEYS.leads, leads); renderHome(); renderRequests(); renderLeads(); renderMembers(); renderActivity(); }

  function applyTheme(t) { document.documentElement.style.setProperty("--green", t.green); document.documentElement.style.setProperty("--orange", t.orange); document.documentElement.style.setProperty("--bg", t.bg); $("#greenColor").value = t.green; $("#orangeColor").value = t.orange; $("#bgColor").value = t.bg; }
  function augmentSettings() {
    const names = ["identidad", "funcionarios", "roles", "admision", "mensajes", "seguridad", "respaldo"];
    $$(".settings-nav button").forEach((b, i) => { b.dataset.setting = names[i]; b.onclick = () => { $$(".settings-nav button").forEach(x => x.classList.toggle("active", x === b)); renderSetting(names[i]); }; });
    renderSetting("identidad");
  }

  function renderSetting(name) {
    const p = $(".settings-panel"), head = (t, d) => `<h2>${t}</h2><p>${d}</p>`;
    if (name === "identidad") {
      const t = Object.assign({}, DEFAULTS, read(KEYS.theme, {})); p.innerHTML = head("Identidad visual", "Colores e identidad de la cooperativa.") + `<div class="colorrow"><div class="colorbox"><label>Principal</label><input type="color" id="greenColor" value="${t.green}"></div><div class="colorbox"><label>Acento</label><input type="color" id="orangeColor" value="${t.orange}"></div><div class="colorbox"><label>Fondo</label><input type="color" id="bgColor" value="${t.bg}"></div></div><button class="btn btn-primary" id="saveTheme" style="margin-top:16px">Guardar apariencia</button>`; ["green","orange","bg"].forEach(k => $("#"+k+"Color").oninput=e=>document.documentElement.style.setProperty("--"+k,e.target.value)); $("#saveTheme").onclick=()=>{const v={green:$("#greenColor").value,orange:$("#orangeColor").value,bg:$("#bgColor").value};write(KEYS.theme,v);applyTheme(v);toast("Apariencia guardada")}; return;
    }
    if (name === "funcionarios") {
      if (!supabaseClient) { p.innerHTML = head("Funcionarios", "Se activa cuando el panel está conectado a Supabase.") + '<div class="empty">Conectá Supabase para ver el equipo real (ver config.js).</div>'; return; }
      p.innerHTML = head("Funcionarios", "Administrá desde acá a las personas autorizadas para usar el panel. Cada una tendrá su propio usuario, rol y trazabilidad.") + `${esSuperadmin() ? '<button class="btn btn-primary" id="inviteStaff" style="margin:12px 0 16px">+ Invitar funcionario</button>' : ''}<div class="list" id="staffList"><div class="empty">Cargando…</div></div>`;
      if (esSuperadmin()) $("#inviteStaff").onclick = () => {
        modal("Invitar funcionario", `<form id="inviteStaffForm" class="op-form"><label>Nombre completo<input required name="nombre" autocomplete="name"></label><label>Correo personal o institucional<input required type="email" name="email" autocomplete="email"></label><label>Teléfono<input name="telefono" inputmode="tel"></label><label>Cargo<input required name="cargo" placeholder="Ej. Tesorería"></label><label>Rol<select name="rol">${Object.entries(ROL_LABEL).filter(([value]) => value !== "superadministrador").map(([value,label]) => `<option value="${value}">${esc(label)}</option>`).join("")}</select></label><div class="op-wide"><small>Recibirá un correo seguro para crear su contraseña. No hace falta entrar al panel técnico de Supabase.</small></div><div class="op-wide" style="display:flex;justify-content:flex-end;gap:8px"><button type="button" class="btn btn-secondary" id="cancelInvite">Cancelar</button><button class="btn btn-primary">Enviar invitación</button></div></form>`);
        $("#cancelInvite").onclick = closeModal;
        $("#inviteStaffForm").onsubmit = async (e) => { e.preventDefault(); const values = Object.fromEntries(new FormData(e.target)); const submit = e.submitter; submit.disabled = true; try { const { data, error } = await supabaseClient.functions.invoke("administrar-usuarios", { body: { action: "invite", ...values, redirectTo: `${siteBase()}/panel.html?invite=1` } }); if (error) throw error; if (data && data.error) throw Error(data.error); closeModal(); toast("Invitación enviada"); renderSetting("funcionarios"); } catch (err) { submit.disabled = false; toast(friendlyError(err, "No se pudo enviar la invitación")); } };
      };
      supabaseClient.from("perfiles_admin").select("*").order("created_at", { ascending: true }).then(({ data, error }) => {
        if (error) { $("#staffList").innerHTML = `<div class="empty">${esc(error.message)}</div>`; return; }
        const roleOptions = Object.entries(ROL_LABEL).map(([value, label]) => `<option value="${value}">${esc(label)}</option>`).join("");
        $("#staffList").innerHTML = (data || []).map((s) => `<div class="item"><div class="item-main"><strong>${esc(s.nombre)}</strong><small>${esc(s.cargo)} · ${esc(s.correo || "—")}${s.telefono ? ` · ${esc(s.telefono)}` : ""}</small><span class="badge ${s.activo === false ? "observada" : "activo"}">${s.activo === false ? "Desactivado" : "Activo"}</span></div>${esSuperadmin() ? `<div class="staff-actions"><select data-role-for="${esc(s.id)}" data-current-role="${esc(s.rol)}" ${s.id === perfilActual.id ? "disabled title=\"No podés cambiar tu propio rol\"" : ""}>${roleOptions}</select>${s.id !== perfilActual.id ? `<button class="btn btn-secondary" data-toggle-staff="${esc(s.id)}" data-active="${s.activo === false ? "false" : "true"}">${s.activo === false ? "Activar" : "Desactivar"}</button>` : ""}</div>` : `<span class="badge activo">${esc(ROL_LABEL[s.rol] || s.rol)}</span>`}</div>`).join("") || '<div class="empty">Todavía no hay funcionarios registrados.</div>';
        $$('[data-role-for]').forEach((sel) => { sel.value = sel.dataset.currentRole; });
        $$('[data-role-for]').forEach((sel) => sel.onchange = busyClick(sel, async () => {
          try { const { error: e2 } = await supabaseClient.rpc("fn_actualizar_rol_perfil", { p_id: sel.dataset.roleFor, p_rol: sel.value }); if (e2) throw e2; log(`${perfilActual.nombre} cambió el rol de un funcionario`); toast("Rol actualizado"); }
          catch (err) { toast(friendlyError(err, "No se pudo cambiar el rol")); renderSetting(name); }
        }));
        $$('[data-toggle-staff]').forEach((button) => button.onclick = busyClick(button, async () => { try { const activate = button.dataset.active !== "true"; const { error: e2 } = await supabaseClient.rpc("fn_actualizar_estado_perfil", { p_id: button.dataset.toggleStaff, p_activo: activate }); if (e2) throw e2; toast(activate ? "Usuario activado" : "Usuario desactivado"); renderSetting("funcionarios"); } catch (err) { toast(friendlyError(err, "No se pudo cambiar el estado")); } }));
      });
      return;
    }
    if (name === "roles") {
      const descriptions = { superadministrador:"Acceso completo, configuración y asignación de roles.", consejo:"Resoluciones, admisiones y consulta institucional.", admision:"Solicitudes, pre-registros, expedientes y tareas de admisión.", secretaria:"Documentos, resoluciones, padrón y tareas administrativas.", tesoreria:"Aportes, solidaridad, comprobantes y reportes de caja.", atencion:"Contactos, campañas, comunicaciones y seguimiento.", auditoria:"Consulta de información y auditoría, sin modificar registros.", lectura:"Consulta general sin acciones de gestión." };
      p.innerHTML = head("Roles y permisos", "Cada funcionario recibe un rol según su trabajo. Solo un superadministrador puede cambiarlo desde Funcionarios.") + `<div class="list">${Object.entries(ROL_LABEL).map(([value,label])=>`<div class="item"><div class="item-main"><strong>${esc(label)}</strong><small>${esc(descriptions[value])}</small></div></div>`).join("")}</div>`;
      return;
    }
    if (name === "admision") {
      const proximo = configInstitucional ? configInstitucional.proximo_numero_socio : config.proximoSocio;
      const fee = configInstitucional ? configInstitucional.derecho_admision : (config.derechoAdmision || 150000);
      const cerrada = configInstitucional && configInstitucional.cierre_fundacional;
      p.innerHTML = head("Admisión", "Numeración y parámetros del proceso.") +
        `<div style="display:flex;flex-direction:column;gap:14px;margin-top:6px">` +
        `<div class="card panel"><h3 style="font-size:13px;margin:0 0 4px">Numeración de socios</h3><p style="color:var(--muted);font-size:12px;margin:0 0 12px">El servidor asigna cada número automáticamente al aprobar una solicitud; no se puede editar a mano.</p><div class="formfield"><label>Próximo N.º de socio</label><input value="${esc(String(proximo).padStart(4,"0"))}" disabled></div>${supabaseClient && esSuperadmin() ? `<button class="btn btn-secondary" id="corregirSecuencia" style="margin-top:14px">Corregir secuencia</button>` : ""}</div>` +
        `<div class="card panel"><h3 style="font-size:13px;margin:0 0 4px">Derecho de admisión</h3><p style="color:var(--muted);font-size:12px;margin:0 0 12px">Monto que se le informa a cada solicitante al iniciar el trámite.</p><div class="formfield"><label>Monto (Gs.)</label><input id="fee" type="text" inputmode="numeric" data-money value="${fmtGsInput(fee)}" ${supabaseClient ? "" : "disabled"}></div>${supabaseClient ? `<button class="btn btn-primary" id="saveAdmission" style="margin-top:14px">Guardar</button>` : ""}</div>` +
        `<div class="card panel"><h3 style="font-size:13px;margin:0 0 6px">Nómina fundacional</h3><p style="color:var(--muted);font-size:12px;margin:0 0 12px">${cerrada ? `Cerrada${configInstitucional.cierre_fundacional_por ? " por " + esc(configInstitucional.cierre_fundacional_por) : ""}${configInstitucional.cierre_fundacional_fecha ? " el " + esc(fmtDate(configInstitucional.cierre_fundacional_fecha)) : ""}${configInstitucional.cierre_fundacional_referencia_acta ? " · " + esc(configInstitucional.cierre_fundacional_referencia_acta) : ""}. Ya no se pueden importar ni agregar fundadores nuevos.` : "Mientras esté abierta, se pueden seguir importando fundadores. Cerrala una vez que la nómina esté completa y confirmada, con la referencia del acta que lo respalda."}</p>${cerrada || !supabaseClient ? "" : `<button class="btn" style="background:var(--danger);color:white" id="cerrarNomina" ${esSuperadmin() ? "" : "disabled title=\"Solo un superadministrador puede cerrar la nómina\""}>Cerrar nómina fundacional</button>`}</div>` +
        `</div>`;
      bindGsInput($("#fee"));
      if ($("#saveAdmission")) $("#saveAdmission").onclick = busyClick($("#saveAdmission"), async () => {
        try {
          const { data, error } = await supabaseClient.rpc("fn_actualizar_configuracion_institucional", { p_derecho_admision: parseGs($("#fee").value) || 150000 });
          if (error) throw error;
          configInstitucional = data; toast("Admisión guardada");
        } catch (err) { toast(friendlyError(err, "No se pudo guardar")); }
      });
      if ($("#corregirSecuencia")) $("#corregirSecuencia").onclick = busyClick($("#corregirSecuencia"), async () => {
        const actual = configInstitucional ? configInstitucional.proximo_numero_socio : config.proximoSocio;
        const nuevoStr = prompt(`Próximo N.º de socio actual: ${String(actual).padStart(4, "0")}. Ingresá el número correcto:`, String(actual));
        if (nuevoStr == null) return;
        const nuevo = parseInt(nuevoStr.trim(), 10);
        if (!Number.isFinite(nuevo) || nuevo < 1) return toast("Ingresá un número válido");
        const motivo = prompt("Motivo de la corrección (queda registrado en la auditoría):");
        if (motivo == null) return;
        if (!motivo.trim()) return toast("El motivo es obligatorio para corregir la secuencia");
        if (!confirm(`¿Confirmás cambiar el próximo N.º de socio de ${String(actual).padStart(4, "0")} a ${String(nuevo).padStart(4, "0")}?`)) return;
        try {
          const { data, error } = await supabaseClient.rpc("fn_corregir_secuencia_socios", { p_proximo_numero: nuevo, p_motivo: motivo.trim() });
          if (error) throw error;
          configInstitucional = data; log(`${perfilActual ? perfilActual.nombre : config.administrador} corrigió la secuencia de socios (${motivo.trim()})`); renderSetting(name); toast("Secuencia corregida");
        } catch (err) { toast(friendlyError(err, "No se pudo corregir la secuencia")); }
      });
      if ($("#cerrarNomina")) $("#cerrarNomina").onclick = busyClick($("#cerrarNomina"), async () => {
        const referencia = prompt('Ingresá la referencia del acta que respalda el cierre (ej. "Acta N.º 3, Asamblea del 22/08/2026"):');
        if (referencia == null) return;
        if (!referencia.trim()) return toast("El cierre de la nómina requiere la referencia del acta");
        if (!confirm("¿Cerrar la nómina fundacional? Después de esto no se van a poder importar ni agregar fundadores nuevos, solo corregir datos de los existentes.")) return;
        try {
          const { data, error } = await supabaseClient.rpc("fn_cerrar_nomina_fundacional", { p_referencia_acta: referencia.trim() });
          if (error) throw error;
          configInstitucional = data; log(`${perfilActual ? perfilActual.nombre : config.administrador} cerró la nómina fundacional (${referencia.trim()})`); renderSetting(name); toast("Nómina fundacional cerrada");
        } catch (err) { toast(friendlyError(err, "No se pudo cerrar la nómina")); }
      });
      return;
    }
    if (name === "mensajes") { p.innerHTML=head("Mensajes","Plantilla para enviar el formulario por WhatsApp.")+`<div class="formfield"><label>Invitación</label><textarea id="msgInvite" rows="6" style="width:100%;border:1px solid var(--line);border-radius:12px;padding:10px">${esc(config.mensajeInvitacion||"Hola {nombre}, te compartimos el formulario de admisión: {link}")}</textarea></div><button class="btn btn-primary" id="saveMsg" style="margin-top:14px">Guardar</button>`;$("#saveMsg").onclick=()=>{config.mensajeInvitacion=$("#msgInvite").value;write(KEYS.config,config);toast("Mensaje guardado")};return; }
    if (name === "seguridad") {
      if (supabaseClient) {
        p.innerHTML = head("Seguridad", "El acceso al panel lo protege el login de Supabase — ya no hace falta un PIN local.") + `<div class="item"><div class="item-main"><strong>Tu contraseña</strong><small>Cambiala desde tu perfil (ícono de la esquina superior derecha del panel).</small></div></div><div class="item"><div class="item-main"><strong>Quién puede aprobar/rechazar</strong><small>Lo define el rol de cada persona — ver Configuraciones → Roles y permisos.</small></div></div>`;
        return;
      }
      p.innerHTML=head("Seguridad","Protección local mientras no exista autenticación.")+`<div class="formgrid"><div class="formfield"><label>PIN de 4 a 6 números</label><input id="pin" type="password" maxlength="6" value="${esc(config.pin||"")}"></div><div class="formfield"><label>Confirmar eliminaciones</label><select id="confirmDelete"><option value="1">Sí</option><option value="0">No</option></select></div></div><button class="btn btn-primary" id="saveSecurity" style="margin-top:14px">Guardar</button>`;$("#saveSecurity").onclick=()=>{const v=$("#pin").value;if(v&&!/^\d{4,6}$/.test(v))return toast("PIN inválido");config.pin=v;config.confirmarBorrado=$("#confirmDelete").value==="1";write(KEYS.config,config);toast("Seguridad guardada")};return; }
    if (name === "respaldo") { p.innerHTML=head("Respaldo","Descargá, restaurá o limpiá la base local.")+`<p><strong>${solicitudes.length}</strong> solicitudes · <strong>${leads.length}</strong> pre-registros</p><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-primary" id="backupBtn">Descargar</button><label class="btn btn-secondary">Importar<input id="restoreInput" type="file" accept="application/json" hidden></label><button class="btn" style="background:var(--danger);color:white" id="clearData">Borrar datos</button></div>`;$("#backupBtn").onclick=()=>{const a=document.createElement("a"),blob=new Blob([JSON.stringify({app:"Cimientos Beta Local",solicitudes,leads,actividad,config},null,2)],{type:"application/json"});a.href=URL.createObjectURL(blob);a.download="respaldo-cimientos.json";a.click()};$("#restoreInput").onchange=e=>{const f=e.target.files[0];if(!f)return;const rd=new FileReader();rd.onload=()=>{try{const d=JSON.parse(rd.result);if(d.app!=="Cimientos Beta Local")throw Error("Archivo no válido");solicitudes=d.solicitudes||[];leads=d.leads||[];actividad=d.actividad||[];config=Object.assign({},DEFAULTS,d.config||{});saveSolicitudes();saveLeads();write(KEYS.actividad,actividad);write(KEYS.config,config);renderAll();renderSetting(name)}catch(x){toast(x.message)}};rd.readAsText(f)};$("#clearData").onclick=()=>{if(!confirm("¿Borrar todos los datos locales?"))return;solicitudes=[];leads=[];actividad=[];saveSolicitudes();saveLeads();write(KEYS.actividad,[]);renderAll();renderSetting(name)}; }
  }

  function initials(name) { return String(name || "A").trim().split(/\s+/).slice(0, 2).map(x => x[0]).join("").toUpperCase(); }
  const ROL_LABEL = { superadministrador: "Superadministrador", consejo: "Consejo de Administración", admision: "Admisión", secretaria: "Secretaría", tesoreria: "Tesorería", atencion: "Atención al socio", auditoria: "Auditoría", lectura: "Solo lectura" };
  function updateProfileUI() {
    const p = $("#profileBtn"), av = p.querySelector(".avatar"), strong = p.querySelector("strong"), small = p.querySelector("small");
    const nombre = perfilActual ? perfilActual.nombre : config.administrador;
    const cargo = perfilActual ? (ROL_LABEL[perfilActual.rol] || perfilActual.cargo) : (config.cargoAdministrador || "Administrador");
    const foto = perfilActual ? perfilActual.foto_base64 : config.fotoAdministrador;
    strong.textContent = nombre; small.textContent = cargo;
    av.innerHTML = foto ? `<img class="profile-photo" src="${foto}" alt="">` : esc(initials(nombre));
  }
  async function signOutPanel() {
    [KEYS.solicitudes, KEYS.leads, KEYS.actividad].forEach((key) => localStorage.removeItem(key));
    if (supabaseClient) await supabaseClient.auth.signOut();
    location.reload();
  }
  async function openProfile() {
    const cloud = !!supabaseClient && !!perfilActual;
    const authEmail = cloud ? (perfilActual.correo || "") : (config.correoAdministrador || "");
    const nombreActual = cloud ? perfilActual.nombre : config.administrador;
    const fotoActual = cloud ? perfilActual.foto_base64 : config.fotoAdministrador;
    const telefonoActual = cloud ? (perfilActual.telefono || "") : (config.telefonoAdministrador || "");
    const cargoActual = cloud ? (perfilActual.cargo || "") : (config.cargoAdministrador || "");
    const rolActualLabel = cloud ? (ROL_LABEL[perfilActual.rol] || perfilActual.rol) : (config.cargoAdministrador || "Superadministrador");
    const avatar = fotoActual ? `<img src="${fotoActual}" alt="Foto de perfil">` : esc(initials(nombreActual));
    modal("Mi perfil", `<div class="profile-sheet"><div><div class="profile-avatar-large" id="profilePreview">${avatar}</div><label class="btn btn-secondary" style="display:block;text-align:center;margin-top:10px">Cambiar foto<input type="file" id="profilePhoto" accept="image/*" hidden></label></div><div><div class="formfield"><label>Nombre visible</label><input id="profileName" value="${esc(nombreActual)}"></div><div class="formfield" style="margin-top:12px"><label>Correo de acceso</label><input id="profileEmail" type="email" value="${esc(authEmail)}" ${cloud ? "" : "readonly"}><small>${cloud ? "Si lo cambiás, Supabase enviará una confirmación al nuevo correo." : "Disponible al conectar Supabase."}</small></div><div class="profile-grid"><div class="formfield"><label>Teléfono</label><input id="profilePhone" inputmode="tel" value="${esc(telefonoActual)}"></div><div class="formfield"><label>Cargo</label><input id="profilePosition" value="${esc(cargoActual)}"></div></div><div class="formfield" style="margin-top:12px"><label>Rol y estado</label><input id="profileRole" value="${esc(rolActualLabel)} · ${cloud && perfilActual.activo === false ? "Desactivado" : "Activo"}" readonly title="Lo asigna un superadministrador desde Configuraciones → Funcionarios"></div><div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px"><button class="btn btn-secondary" id="profileActivity">Ver actividad</button><button class="btn btn-primary" id="profileSave">Guardar perfil</button></div></div></div><div class="profile-security"><h3>Seguridad</h3>${cloud ? '<button class="profile-action" id="profilePassword">Cambiar contraseña</button><div class="profile-session"><strong>Sesión actual protegida</strong><span>Acceso autenticado mediante Supabase.</span></div>' : ""}<button class="profile-action" id="profileSettings">Editar en Configuración</button>${cloud ? '<button class="profile-action danger" id="profileLogout">Cerrar sesión</button>' : ""}</div>`);
    let pendingPhoto = fotoActual || ""; $("#profilePhoto").onchange = e => { const f = e.target.files[0]; if (!f) return; if (f.size > 1500000) return toast("La imagen debe pesar menos de 1,5 MB"); const rd = new FileReader(); rd.onload = () => { pendingPhoto = rd.result; $("#profilePreview").innerHTML = `<img src="${pendingPhoto}" alt="Vista previa">` }; rd.readAsDataURL(f); };
    $("#profileActivity").onclick = () => { closeModal(); go("actividad") };
    $("#profileSave").onclick = busyClick($("#profileSave"), async () => {
      const n = $("#profileName").value.trim(), email = $("#profileEmail").value.trim(), telefono = $("#profilePhone").value.trim(), cargoNuevo = $("#profilePosition").value.trim(); if (!n) return toast("Ingresá tu nombre");
      if (cloud) {
        try {
          if (email && email !== authEmail) { const change = await supabaseClient.auth.updateUser({ email }); if (change.error) throw change.error; }
          const { data, error } = await supabaseClient.from("perfiles_admin").update({ nombre: n, telefono, cargo: cargoNuevo || "Administrador", foto_base64: pendingPhoto, updated_at: now() }).eq("id", perfilActual.id).select().single();
          if (error) throw error;
          perfilActual = data; updateProfileUI(); log("Se actualizó el perfil administrador"); closeModal(); toast(email !== authEmail ? "Perfil guardado; confirmá el nuevo correo" : "Perfil guardado");
        } catch (err) { toast(friendlyError(err, "No se pudo guardar el perfil")); }
        return;
      }
      config.administrador = n; config.fotoAdministrador = pendingPhoto; config.telefonoAdministrador = telefono; config.cargoAdministrador = cargoNuevo || config.cargoAdministrador; write(KEYS.config, config); updateProfileUI(); log("Se actualizó el perfil administrador"); closeModal(); toast("Perfil guardado");
    });
    $("#profileSettings").onclick = () => { closeModal(); go("config") };
    if (cloud) {
      $("#profileLogout").onclick = signOutPanel;
      $("#profilePassword").onclick = () => { modal("Cambiar contraseña", `<p style="color:var(--muted);font-size:12px">Usá una contraseña de al menos 8 caracteres.</p><div class="formfield"><label>Nueva contraseña</label><input id="newPassword" type="password" minlength="8" autocomplete="new-password"></div><div style="display:flex;justify-content:flex-end;margin-top:16px"><button class="btn btn-primary" id="savePassword">Actualizar contraseña</button></div>`); $("#savePassword").onclick = async () => { const password = $("#newPassword").value; if (password.length < 8) return toast("La contraseña debe tener al menos 8 caracteres"); const { error } = await supabaseClient.auth.updateUser({ password }); if (error) return toast("No se pudo cambiar la contraseña"); closeModal(); toast("Contraseña actualizada") }; };
    }
  }
  function decorateIcons(){const icons={inicio:'<path d="M3 11 12 3l9 8"/><path d="M5 10v10h14V10M9 20v-6h6v6"/>',solicitudes:'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>',preregistros:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M16 11h6"/>',socios:'<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',actividad:'<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',config:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.09A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.09A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.09A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.14.38.36.72.65 1 .3.28.68.43 1.1.4H21v4h-.09A1.7 1.7 0 0 0 19.4 15Z"/>'};$$('[data-go] .ico').forEach(e=>{const k=e.closest('[data-go]').dataset.go;if(icons[k])e.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true">${icons[k]}</svg>`});$$('.quick [data-go]').forEach(e=>{const k=e.dataset.go,b=e.querySelector('b');if(b&&icons[k])b.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true">${icons[k]}</svg>`});$$('.mobilebar [data-go]').forEach(e=>{const k=e.dataset.go,b=e.querySelector('b');if(b&&icons[k])b.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true">${icons[k]}</svg>`})}
  $$('[data-go]').forEach((b) => b.addEventListener("click", () => go(b.dataset.go)));
  $$(".filters button").forEach((b) => b.onclick = () => { $$(".filters button").forEach((x) => x.classList.remove("active")); b.classList.add("active"); filter = b.dataset.filter; renderRequests(); });
  $("#requestSearch").oninput = renderRequests; $("#memberSearch").oninput = renderMembers;
  $("#memberTypeFilter").addEventListener("click", (e) => { const b = e.target.closest("[data-member-filter]"); if (!b) return; $$("#memberTypeFilter button").forEach((x) => x.classList.remove("active")); b.classList.add("active"); memberFilter = b.dataset.memberFilter; renderMembers(); });
  $("#importFundadores").onclick = () => {
    if (configInstitucional && configInstitucional.cierre_fundacional) {
      return modal("Nómina fundacional cerrada", `<p style="color:var(--muted);font-size:13px">La nómina de fundadores quedó cerrada técnicamente${configInstitucional.cierre_fundacional_por ? ` por ${esc(configInstitucional.cierre_fundacional_por)}` : ""}${configInstitucional.cierre_fundacional_fecha ? ` el ${esc(fmtDate(configInstitucional.cierre_fundacional_fecha))}` : ""}. Ya no se pueden importar ni agregar fundadores nuevos — solo corregir datos de un fundador existente, abriendo su ficha en el Libro de Socios.</p><div style="display:flex;justify-content:flex-end;margin-top:16px"><button class="btn btn-primary" id="fCierreOk">Entendido</button></div>`), void ($("#fCierreOk").onclick = closeModal);
    }
    if (!requireProfileGuard()) return;
    modal("Importar fundadores", `<p style="color:var(--muted);font-size:12px">La nómina de fundadores es cerrada. Esta herramienta solo completa la carga inicial. Columnas mínimas: <strong>numero_socio, apellidos_nombres, cedula</strong>.</p><div class="formfield"><label>Planilla Excel o CSV</label><input id="founderFile" type="file" accept=".xlsx,.xls,.csv"></div><div id="founderImportStatus" style="margin-top:12px;font-size:12px;color:var(--muted)"></div><div style="display:flex;justify-content:flex-end;margin-top:16px"><button class="btn btn-primary" id="founderValidate">Validar e importar</button></div>`);
    $("#founderValidate").onclick=busyClick($("#founderValidate"),async()=>{const file=$("#founderFile").files?.[0],status=$("#founderImportStatus");if(!file)return toast("Elegí una planilla");try{const data=await file.arrayBuffer(),book=XLSX.read(data),rows=XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]],{defval:""});if(!rows.length)throw Error("La planilla está vacía");const clean=rows.map((row,i)=>{const numero=String(row.numero_socio||row["N.º de socio"]||row.numero||"").trim(),name=String(row.apellidos_nombres||row.nombre||row["Apellidos y Nombres"]||"").trim(),cedula=String(row.cedula||row["Cédula"]||"").trim();if(!numero||!name||!cedula)throw Error(`Fila ${i+2}: faltan número, nombre o cédula`);return{id:String(row.id||`fundador-${Date.now()}-${i}`),tipo_socio:"fundador",estado:"aprobado",numero_socio:numero.padStart(4,"0"),apellidos_nombres:name,cedula,celular_whatsapp:String(row.celular_whatsapp||row.celular||""),correo_electronico:String(row.correo_electronico||row.correo||""),created_at:row.created_at||now(),fecha_constitucion:FECHA_CONSTITUCION,datos_pendiente_revision:false}});const numbers=new Set(),ids=new Set();clean.forEach((r)=>{if(numbers.has(r.numero_socio))throw Error(`Número duplicado: ${r.numero_socio}`);if(ids.has(r.cedula))throw Error(`Cédula duplicada: ${r.cedula}`);numbers.add(r.numero_socio);ids.add(r.cedula)});for(const r of clean){const existing=solicitudes.find((x)=>tipoSocio(x)==="fundador"&&(x.cedula===r.cedula||x.numero_socio===r.numero_socio));if(existing)Object.assign(existing,r,{id:existing.id});else solicitudes.push(r);saveSolicitudes(existing||r)}status.textContent=`${clean.length} fundador(es) importados correctamente.`;log(`${config.administrador} importó ${clean.length} socio(s) fundador(es)`);renderAll();toast("Importación completada")}catch(err){status.textContent=friendlyError(err,"No se pudo importar la planilla");status.style.color="var(--danger)"}});
  };
  // Búsqueda global real: recorre socios admitidos, solicitudes en curso y
  // pre-registros (en ese orden de prioridad) y abre la sección correcta —
  // antes solo miraba el Libro de Socios, aunque el placeholder prometía
  // buscar también solicitudes y cédulas de pre-registro.
  function globalSearch(raw) {
    const q = (raw || "").trim().toLowerCase();
    if (!q) return;
    const socio = solicitudes.find((r) => r.estado === "aprobado" && `${nombre(r)} ${r.cedula || ""} ${r.numero_socio || ""}`.toLowerCase().includes(q));
    if (socio) {
      go("socios"); memberFilter = "todos";
      $$("#memberTypeFilter button").forEach((x) => x.classList.toggle("active", x.dataset.memberFilter === "todos"));
      $("#memberSearch").value = raw; renderMembers();
      return toast(`Encontrado en Libro de Socios: ${nombre(socio)}`);
    }
    const solicitud = solicitudes.find((r) => r.estado !== "aprobado" && `${nombre(r)} ${r.cedula || ""} ${r.numero_solicitud || ""}`.toLowerCase().includes(q));
    if (solicitud) {
      go("solicitudes"); filter = "todos";
      $$(".filters button").forEach((x) => x.classList.toggle("active", x.dataset.filter === "todos"));
      $("#requestSearch").value = raw; renderRequests();
      return toast(`Encontrado en Solicitudes: ${nombre(solicitud)}`);
    }
    const lead = leads.find((r) => `${r.nombre_contacto || ""} ${r.celular_whatsapp || ""}`.toLowerCase().includes(q));
    if (lead) { go("preregistros"); return toast(`Encontrado en Pre-registros: ${lead.nombre_contacto}`); }
    toast(`Sin resultados para "${raw}"`);
  }
  const globalSearchInput = $("#globalSearch"), globalSearchClear = $("#globalSearchClear");
  globalSearchInput.addEventListener("input", () => { globalSearchClear.hidden = !globalSearchInput.value; });
  globalSearchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") globalSearch(globalSearchInput.value);
    if (e.key === "Escape") { globalSearchInput.value = ""; globalSearchClear.hidden = true; globalSearchInput.blur(); }
  });
  globalSearchClear.onclick = () => { globalSearchInput.value = ""; globalSearchClear.hidden = true; globalSearchInput.focus(); };
  $("#newLeadBtn").onclick = () => leadModal(null); $("#modalClose").onclick = closeModal; $("#modalBack").onclick = (e) => { if (e.target === $("#modalBack")) closeModal(); };
  $("#bellBtn").onclick = () => toast(`${solicitudes.filter((r) => r.estado === "pendiente").length + leads.filter((r) => ["pendiente", "enviado", "preparado", "iniciado"].includes(r.estado)).length} asunto(s) pendiente(s)`);
  $("#profileBtn").onclick = openProfile;
  $("#exportBtn").onclick = () => { const cols = ["numero_solicitud", "apellidos_nombres", "cedula", "celular_whatsapp", "estado", "numero_socio", "resolucion_numero", "created_at"]; const csv = [cols.join(",")].concat(solicitudes.map((r) => cols.map((c) => `"${String(r[c] || "").replace(/"/g, '""')}"`).join(","))).join("\n"); const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); a.download = "solicitudes-cimientos.csv"; a.click(); URL.revokeObjectURL(a.href); log(`${config.administrador} exportó las solicitudes`); };
  // El padrón se imprime como documento A4 independiente desde
  // app-operaciones.js; nunca se imprime una captura del panel.
  $("#copySummary").onclick = () => navigator.clipboard?.writeText(`Cimientos: ${solicitudes.filter((r) => r.estado === "pendiente").length} solicitudes pendientes, ${leads.length} pre-registros y ${solicitudes.filter((r) => r.estado === "aprobado").length} socios aprobados.`).then(() => toast("Resumen copiado"));
  const theme = Object.assign({}, DEFAULTS, read(KEYS.theme, {})); applyTheme(theme);
  ["green", "orange", "bg"].forEach((k) => $("#" + k + "Color").oninput = (e) => document.documentElement.style.setProperty("--" + k, e.target.value));
  $("#saveTheme").onclick = () => { const t = { green: $("#greenColor").value, orange: $("#orangeColor").value, bg: $("#bgColor").value }; write(KEYS.theme, t); applyTheme(t); toast("Apariencia guardada"); };
  $("#resetTheme").onclick = () => { localStorage.removeItem(KEYS.theme); applyTheme(DEFAULTS); toast("Paleta restablecida"); };
  $("#themeBtn").onclick = () => { dark = !dark; document.documentElement.style.setProperty("--bg", dark ? "#171918" : $("#bgColor").value); document.documentElement.style.setProperty("--card", dark ? "rgba(37,40,38,.88)" : "rgba(255,255,255,.88)"); document.documentElement.style.setProperty("--ink", dark ? "#f5f5f2" : "#202124"); document.documentElement.style.setProperty("--muted", dark ? "#a8aca8" : "#72767d"); document.documentElement.style.setProperty("--sidebar", dark ? "rgba(28,30,29,.9)" : "rgba(246,247,244,.86)"); };
  // ---------------- Login administrado por Supabase ----------------
  // LOGIN_REQUIRED se controla desde config.js. En producción permanece
  // activo para que ningún dato administrativo quede expuesto.
  const loginRequired = typeof LOGIN_REQUIRED !== "undefined" && LOGIN_REQUIRED === true;

  async function startApp() {
    $("#today").textContent = new Intl.DateTimeFormat("es-PY", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());
    if (supabaseClient) {
      // El perfil y la configuración institucional definen permisos
      // (rol, cierre de fundadores), así que se cargan ANTES de pintar
      // el panel para que los botones ya aparezcan bien habilitados/deshabilitados.
      await Promise.all([cargarPerfilActual(), cargarConfigInstitucional()]);
    }
    decorateIcons(); updateProfileUI(); augmentSettings(); renderAll();
    // Si Supabase está configurado, lo local se ve primero (instantáneo)
    // y se actualiza apenas llega la respuesta del servidor.
    cargarDesdeSupabase();
    if (new URLSearchParams(location.search).get("invite") === "1") {
      setTimeout(() => {
        modal("Crear tu contraseña", `<p style="color:var(--muted);font-size:12px">Tu invitación fue aceptada. Elegí una contraseña de al menos 8 caracteres para ingresar al panel.</p><div class="formfield"><label>Nueva contraseña</label><input id="invitePassword" type="password" minlength="8" autocomplete="new-password"></div><div style="display:flex;justify-content:flex-end;margin-top:16px"><button class="btn btn-primary" id="saveInvitePassword">Guardar contraseña</button></div>`);
        $("#saveInvitePassword").onclick = async () => { const password = $("#invitePassword").value; if (password.length < 8) return toast("La contraseña debe tener al menos 8 caracteres"); const { error } = await supabaseClient.auth.updateUser({ password }); if (error) return toast("No se pudo guardar la contraseña"); history.replaceState({}, "", "panel.html"); closeModal(); toast("Contraseña creada. Ya podés usar el panel."); };
      }, 250);
    }
  }

  async function initAuthGate() {
    const loginScreen = $("#loginScreen");
    if (!loginRequired || !supabaseClient) { if (loginScreen) loginScreen.style.display = "none"; startApp(); return; }
    const loginForm = $("#loginForm");
    const loginError = $("#loginError");
    const loginBtn = $("#loginBtn");
    const logoutBtn = $("#logoutBtn");
    function showLogin() { if (loginScreen) loginScreen.style.display = "grid"; if (logoutBtn) logoutBtn.style.display = "none"; }
    function showPanel() { if (loginScreen) loginScreen.style.display = "none"; if (logoutBtn) logoutBtn.style.display = ""; }
    try {
      const { data } = await supabaseClient.auth.getSession();
      if (data && data.session) { showPanel(); startApp(); } else { showLogin(); }
    } catch (err) { console.error("Supabase (sesión):", err); showLogin(); }
    if (loginForm) loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (loginError) loginError.style.display = "none";
      const emailEl = $("#loginEmail"), passEl = $("#loginPassword");
      loginBtn.disabled = true;
      const label = loginBtn.textContent;
      loginBtn.textContent = "Ingresando…";
      const { error } = await supabaseClient.auth.signInWithPassword({ email: emailEl.value.trim(), password: passEl.value });
      loginBtn.disabled = false;
      loginBtn.textContent = label;
      if (error) { if (loginError) { loginError.textContent = "Correo o contraseña incorrectos."; loginError.style.display = "block"; } return; }
      showPanel(); startApp();
    });
    if (logoutBtn) logoutBtn.addEventListener("click", async () => {
      [KEYS.solicitudes, KEYS.leads, KEYS.actividad].forEach((key) => localStorage.removeItem(key));
      await supabaseClient.auth.signOut();
      location.reload();
    });
  }

  initAuthGate();
})();
