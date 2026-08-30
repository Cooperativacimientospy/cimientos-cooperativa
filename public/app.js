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
  const DEFAULTS = { green: "#6a9c20", orange: "#ff7a00", bg: "#f3f4f1", proximoSocio: 1, administrador: "Administrador local", correoAdministrador: "", cargoAdministrador: "Superadministrador", fotoAdministrador: "" };
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; } catch (_) { return fallback; } };
  const write = (key, value) => {
    if (cloudConfigured && [KEYS.solicitudes, KEYS.leads, KEYS.actividad].includes(key)) return;
    localStorage.setItem(key, JSON.stringify(value));
  };
  const fmtDate = (v) => { if (!v) return "—"; const d = new Date(v); return Number.isNaN(d.getTime()) ? esc(v) : new Intl.DateTimeFormat("es-PY", { day: "2-digit", month: "2-digit", year: "numeric" }).format(d); };
  const fmtGs = (v) => "Gs. " + (Number(v) || 0).toLocaleString("es-PY");
  const now = () => new Date().toISOString();

  let solicitudes = cloudConfigured ? [] : read(KEYS.solicitudes, []);
  let leads = cloudConfigured ? [] : read(KEYS.leads, []);
  let actividad = cloudConfigured ? [] : read(KEYS.actividad, []);
  let config = Object.assign({}, DEFAULTS, read(KEYS.config, {}));
  let filter = "todos";
  let memberFilter = "todos";
  let dark = false;

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
  function badge(s) { const labels = { pendiente: "Pendiente", observado: "Observada", observada: "Observada", aprobado: "Aprobada", rechazado: "Rechazada", enviado: "Link enviado", completado: "Completado", descartado: "Descartado", activo: "Activo" }; const cls = s === "observado" ? "observada" : s; return `<span class="badge ${esc(cls)}">${labels[s] || esc(s)}</span>`; }
  function modal(title, html) { $("#modalTitle").textContent = title; $("#modalBody").innerHTML = html; $("#modalBack").classList.add("open"); }
  function closeModal() { $("#modalBack").classList.remove("open"); }
  function nombre(r) { return r.apellidos_nombres || r.nombre || "Sin nombre"; }
  function tel(r) { return r.celular_whatsapp || r.tel || ""; }
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

  function renderHome() {
    const pendientes = solicitudes.filter((r) => r.estado === "pendiente").length;
    const abiertos = leads.filter((r) => ["pendiente", "enviado"].includes(r.estado)).length;
    const socios = solicitudes.filter((r) => r.estado === "aprobado").length;
    const kpis = $$("#view-inicio .kpi strong");
    if (kpis[0]) kpis[0].textContent = pendientes;
    if (kpis[1]) kpis[1].textContent = abiertos;
    if (kpis[2]) kpis[2].textContent = socios;
    if (kpis[3]) kpis[3].textContent = actividad.length;
    const alertas = [];
    if (pendientes) alertas.push(`<div class="item"><span class="dot"></span><div class="item-main"><strong>${pendientes} solicitud(es) esperan revisión</strong><small>Abrí Admisión para continuar.</small></div>${badge("pendiente")}</div>`);
    if (abiertos) alertas.push(`<div class="item"><span class="dot" style="background:var(--blue)"></span><div class="item-main"><strong>${abiertos} pre-registro(s) necesitan seguimiento</strong><small>Podés preparar el mensaje de WhatsApp.</small></div>${badge("enviado")}</div>`);
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
      $("#reqReview").onclick = () => { closeModal(); fundadorModal(r); };
      return;
    }
    modal(`Solicitud #${r.numero_solicitud || "—"}`, `${photoPickerHtml(r)}<div class="detailgrid">${detail("Solicitante", nombre(r))}${detail("Cédula", r.cedula)}${detail("Nacimiento", fmtDate(r.fecha_nacimiento))}${detail("Celular", tel(r))}${detail("Contacto preferido", r.contacto_preferido)}${detail("Ciudad", [r.ciudad, r.departamento].filter(Boolean).join(", "))}${detail("Dirección", r.direccion)}${detail("Vivienda", r.tipo_vivienda)}${detail("Actividad", r.condicion_laboral)}${detail("Empresa / RUC", r.empresa_ruc)}${detail("Cargo", r.cargo_laboral)}${detail("Antigüedad laboral", r.antiguedad_laboral)}${detail("Dirección laboral", r.direccion_laboral)}${detail("Cargo público/político", r.cargo_publico)}${detail("Trabajo en ONG", r.trabajo_ong)}${detail("Origen de fondos", r.origen_fondos)}${detail("Referente", r.referente_nombre)}${detail("Forma de pago", r.forma_pago)}${detail("Derecho de admisión", fmtGs(r.derecho_admision || 150000))}${detail("Beneficiarios", beneficiaries)}</div><div class="formfield"><label>Notas administrativas</label><textarea id="requestNotes" rows="3" style="width:100%;border:1px solid var(--line);border-radius:12px;padding:10px">${esc(r.notas_admin || "")}</textarea></div><div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;margin-top:16px"><button class="btn btn-whatsapp" id="reqWhatsApp">WhatsApp</button><button class="btn btn-secondary" id="reqPrint">Imprimir ficha</button><button class="btn btn-secondary" id="reqObserve">Observar</button><button class="btn" style="background:var(--danger);color:white" id="reqReject">Rechazar</button><button class="btn btn-primary" id="reqApprove">Aprobar</button></div>`);
    wirePhotoPicker(r);
    $("#reqWhatsApp").onclick = () => shareMemberWhatsApp(r);
    $("#reqPrint").onclick = () => printRequest(r);
    $("#reqObserve").onclick = () => updateRequest(r, "observada");
    $("#reqReject").onclick = () => updateRequest(r, "rechazado");
    $("#reqApprove").onclick = () => approveRequest(r);
  }
  function shareMemberWhatsApp(r) {
    const phone=String(tel(r)||"").replace(/\D/g,"").replace(/^0/,"595");
    if(!phone)return toast("El socio no tiene un número de WhatsApp");
    const msg=`Hola ${nombre(r)}, te enviamos tu ficha de la Cooperativa Cimientos${r.numero_socio?` (Socio N.º ${r.numero_socio})`:""}. En esta beta local, abrí primero “Imprimir ficha”, guardala como PDF y adjuntala a este chat.`;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`,"_blank");
    log(`Se preparó el envío de ficha por WhatsApp para ${nombre(r)}`);
  }
  function updateRequest(r, estado) {
    r.estado = estado; r.notas_admin = $("#requestNotes").value.trim(); r.revisado_por = config.administrador; r.fecha_revision = now(); saveSolicitudes(r); log(`${config.administrador} marcó como ${estado} la solicitud de ${nombre(r)}`); closeModal(); renderAll(); toast("Solicitud actualizada");
  }
  function nextMemberNumber() { const used = solicitudes.map((r) => parseInt(r.numero_socio, 10)).filter(Number.isFinite); return String(Math.max(config.proximoSocio - 1, ...used, 0) + 1).padStart(4, "0"); }
  function approveRequest(r) {
    const suggested = r.numero_socio || nextMemberNumber();
    modal("Aprobar solicitud", `<p style="color:var(--muted);font-size:12px">Asigná el número de socio y la resolución del Consejo.</p><div class="formgrid"><div class="formfield"><label>Número de socio</label><input id="approveNumber" value="${esc(suggested)}"></div><div class="formfield"><label>Número de resolución</label><input id="approveResolution" value="${esc(r.resolucion_numero || "")}" placeholder="Ej. RES-001/2026"></div></div><div class="formfield" style="margin-top:12px"><label>Notas</label><textarea id="approveNotes" rows="3" style="width:100%;border:1px solid var(--line);border-radius:12px;padding:10px">${esc(r.notas_admin || "")}</textarea></div><div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px"><button class="btn btn-secondary" id="approveCancel">Cancelar</button><button class="btn btn-primary" id="approveConfirm">Confirmar admisión</button></div>`);
    $("#approveCancel").onclick = closeModal;
    $("#approveConfirm").onclick = () => { const n = $("#approveNumber").value.trim(); if (!n) return toast("Ingresá el número de socio"); if (!/^\d+$/.test(n)) return toast("El número de socio debe contener solo números"); if (solicitudes.some((x) => x !== r && x.numero_socio === n)) return toast("Ese número ya está asignado"); r.estado = "aprobado"; r.numero_socio = n.padStart(4,"0"); r.resolucion_numero = $("#approveResolution").value.trim(); r.notas_admin = $("#approveNotes").value.trim(); r.revisado_por = config.administrador; r.fecha_revision = now(); config.proximoSocio=Math.max(config.proximoSocio,parseInt(n,10)+1); write(KEYS.config,config); saveSolicitudes(r); log(`${config.administrador} aprobó a ${nombre(r)} como socio N.º ${r.numero_socio}`); closeModal(); renderAll(); toast("Socio admitido"); };
  }

  function printRequest(r) {
    const w = window.open("", "_blank", "width=820,height=900");
    if (!w) return toast("El navegador bloqueó la ventana de impresión. Habilitá los pop-ups para este sitio.");
    w.document.write(memberPrintHtml(r));
    w.document.close();
  }

  function memberPrintHtml(r) {
    const field = (label, value) => `<div class="f"><small>${esc(label)}</small><strong>${esc(value || "—")}</strong></div>`;
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
    const emitido = fmtDate(now());

    const watermark = admitted ? "" : `<div class="watermark">${r.estado === "rechazado" ? "SOLICITUD RECHAZADA" : "EN REVISIÓN"}</div>`;

    const masthead = (tipo, codigo) => `
      <header class="mh">
        <div class="mh-brand">
          <div class="mh-mark">C</div>
          <div class="mh-name"><strong>Cooperativa Cimientos Ltda.</strong><span>Multiactiva de Ahorro, Crédito, Construcción, Industria y Servicios Varios</span></div>
        </div>
        <div class="mh-doc">
          <span class="mh-tag">${esc(tipo)}</span>
          <span class="mh-code">${esc(codigo)}</span>
          <span class="mh-date">Emitido ${esc(emitido)}</span>
        </div>
      </header>`;

    const pageFooter = (codigo) => `
      <footer class="pf">
        <span>Documento interno · Cooperativa Cimientos Ltda.</span>
        <span>${esc(codigo)} · C.I. ${esc(r.cedula || "—")}</span>
      </footer>`;

    const ficha = `
      <article class="paper">
        ${watermark}
        ${masthead("Ficha de Socio", docCode)}
        <div class="identity">
          <h1>${esc(nombre(r))}</h1>
          <div class="chipline">
            <span class="chip">${admitted ? `Socio N.º ${esc(numeroSocio)}` : "Sin número asignado"}</span>
            ${esFundador
              ? `<span class="chip ghost">Socio Fundador</span><span class="chip ghost">Socio desde la constitución — ${esc(fmtDate(r.fecha_constitucion || FECHA_CONSTITUCION))}</span>`
              : `<span class="chip ghost">Solicitud N.º ${esc(numeroSolicitud)}</span><span class="chip ghost">${admitted ? "Admitido el " + esc(fmtDate(r.fecha_revision)) : "Ingresada el " + esc(fmtDate(r.created_at))}</span>`}
          </div>
        </div>
        <section><h2><span class="bar"></span>Datos personales</h2><div class="grid">
          ${field("Cédula de identidad", r.cedula)}${field("Nacionalidad", r.nacionalidad)}
          ${field("Fecha de nacimiento", fmtDate(r.fecha_nacimiento))}${field("Estado civil", r.estado_civil)}
          ${field("Profesión / oficio", r.profesion_oficio)}${field("Género", r.genero)}
        </div></section>
        <section><h2><span class="bar"></span>Domicilio y contacto</h2><div class="grid">
          ${field("Ciudad", r.ciudad)}${field("Barrio", r.barrio)}
          ${field("Dirección", r.direccion)}${field("Celular / WhatsApp", tel(r))}
          ${field("Correo electrónico", r.correo_electronico)}${field("Tipo de vivienda", r.tipo_vivienda)}
        </div></section>
        <section><h2><span class="bar"></span>Actividad económica (SEPRELAD)</h2><div class="grid">
          ${field("Condición laboral", r.condicion_laboral)}${field("Empresa / RUC", r.empresa_ruc)}
          ${field("Cargo / función", r.cargo_laboral)}${field("Antigüedad", r.antiguedad_laboral)}
          ${field("Origen de fondos declarado", r.origen_fondos)}${field("Cargo público / político", r.cargo_publico)}
        </div></section>
        ${esFundador
          ? `<section><h2><span class="bar"></span>Capital fundacional (Art. 8° inc. f)</h2><div class="grid">
          ${field("Certificados suscritos", (r.certificados_suscritos || 100) + " × Gs. 30.000")}${field("Capital suscrito total", fmtGs(r.capital_suscrito || (r.certificados_suscritos || 100) * 30000))}
          ${field("Integrado en la asamblea constitutiva (60%)", fmtGs(r.capital_integrado || Math.round((r.capital_suscrito || 3000000) * 0.6)))}${field("Cuotas del saldo (40%) pagadas", (r.cuotas_saldo_pagadas != null ? r.cuotas_saldo_pagadas : 6) + " de 6")}
        </div></section>`
          : `<section><h2><span class="bar"></span>Aportes y capital</h2><div class="grid">
          ${field("Derecho de admisión", fmtGs(r.derecho_admision || 150000))}${field("Cuotas partes adelantadas", r.cuotas_partes)}
          ${field("Adelanto de aporte inicial", r.monto_adelanto ? fmtGs(r.monto_adelanto) : "—")}${field("Forma de pago declarada", r.forma_pago)}
        </div></section>`}
        <section class="tight"><h2><span class="bar"></span>${esFundador ? "Beneficiarios" : "Socio referente y beneficiarios"}</h2><div class="grid">
          ${esFundador ? "" : field("Socio referente", r.referente_nombre || "Lo asigna el Consejo") + field("Cédula del referente", r.referente_cedula)}
          ${beneficiaries}
        </div></section>
        ${pageFooter(docCode)}
      </article>`;

    const constanciaCode = "CON-" + (r.numero_socio || "—");
    const constancia = admitted ? `
      <article class="paper">
        ${masthead(esFundador ? "Constancia de Socio Fundador" : "Constancia de Admisión", constanciaCode)}
        <div class="cert">
          <span class="cert-eyebrow">Consejo de Administración</span>
          <h1>${esFundador ? "Constancia de Socio Fundador" : "Constancia de Admisión de Socio"}</h1>
          <div class="cert-rule"></div>
          ${esFundador
            ? `<p>El Consejo de Administración de la Cooperativa Multiactiva de Ahorro, Crédito, Construcción, Industria y Servicios Varios &ldquo;Cimientos&rdquo; Limitada certifica que <strong>${esc(nombre(r))}</strong>, con Cédula de Identidad N.º <strong>${esc(r.cedula || "—")}</strong>, reviste la calidad de <span class="cert-num">Socio Fundador</span> bajo el N.º de Socio ${esc(numeroSocio)}, por haber suscripto e integrado el capital fundacional conforme al Acta de la Asamblea Constitutiva de fecha ${esc(fmtDate(r.fecha_constitucion || FECHA_CONSTITUCION))}, de conformidad con el Art. 8° inc. f del Estatuto Social.</p>`
            : `<p>El Consejo de Administración de la Cooperativa Multiactiva de Ahorro, Crédito, Construcción, Industria y Servicios Varios &ldquo;Cimientos&rdquo; Limitada certifica que <strong>${esc(nombre(r))}</strong>, con Cédula de Identidad N.º <strong>${esc(r.cedula || "—")}</strong>, ha sido admitido/a como socio/a ordinario/a bajo el <span class="cert-num">N.º de Socio ${esc(numeroSocio)}</span>, por Resolución <strong>${esc(r.resolucion_numero || "—")}</strong>, de fecha ${esc(fmtDate(r.fecha_revision))}, de conformidad con el Estatuto Social.</p>`}
          <p>Se deja constancia de que el/la socio/a queda sujeto/a al cumplimiento del Estatuto Social, sus Reglamentos internos y las resoluciones de los órganos de la Cooperativa.</p>
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
        ${masthead("Comprobante de Pago", reciboCode)}
        <div class="identity tight">
          <h1>Recibo de aportes de admisión</h1>
          <div class="chipline"><span class="chip ghost">Recibo N.º ${esc(r.recibo_numero || "—")}</span><span class="chip ghost">${esc(fmtDate(r.fecha_pago || now()))}</span></div>
        </div>
        <div class="receipt-box">
          <div class="grid">
            ${field("Recibí de", nombre(r))}${field("Cédula de identidad", r.cedula)}
            ${field("Socio N.º", r.numero_socio)}${field("Forma de pago", r.forma_pago)}
            ${field("Derecho de admisión (Art. 8° inc. c, no reembolsable)", fmtGs(r.derecho_admision || 150000))}${field("Adelanto confirmado", fmtGs(r.monto_adelanto || 0))}
          </div>
          <div class="total-row"><span>Total recibido</span><strong>${fmtGs(total)}</strong></div>
        </div>
        <div class="sign-row">
          <div class="sign-box">${r.firma_base64 ? `<img class="sign-img" src="${r.firma_base64}" alt="Firma">` : ""}<div class="sign-line"></div><span>Firma del socio</span></div>
          <div class="sign-box"><div class="sign-line"></div><span>Firma y sello — Tesorería</span></div>
        </div>
        <p class="legal-note">El derecho de admisión es una tasa única y no reembolsable, fijada por el Consejo de Administración conforme al Art. 8° inc. c del Estatuto Social. A partir de la admisión rige el aporte mensual obligatorio del Art. 8° inc. g (Gs. 50.000: Gs. 30.000 a certificados de aportación + Gs. 20.000 al Fondo de Solidaridad).</p>
        ${pageFooter(reciboCode)}
      </article>` : "";

    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Ficha de socio — ${esc(nombre(r))}</title>
      <link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap" rel="stylesheet">
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
        .mh-mark{width:32px;height:32px;border-radius:10px;background:linear-gradient(150deg,#7cb036,#4f8217);color:#fff;display:grid;place-items:center;font-weight:800;font-size:15px;box-shadow:0 6px 14px rgba(79,130,23,.28)}
        .mh-name strong{display:block;font-size:12px;letter-spacing:.01em}
        .mh-name span{display:block;font-size:7.5px;color:#767b73;max-width:60mm;line-height:1.35;margin-top:2px}
        .mh-doc{text-align:right}
        .mh-tag{display:inline-block;background:#eef4e3;color:#4f8217;font-size:9px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;padding:3px 8px;border-radius:999px}
        .mh-code{display:block;margin-top:4px;font-size:9px;color:#1c1e1c;font-weight:700;letter-spacing:.03em}
        .mh-date{display:block;margin-top:2px;font-size:8px;color:#8a8f89}
        .identity{position:relative;z-index:1;padding-bottom:3.5mm}
        .identity.tight{padding-bottom:5mm}
        .identity h1{margin:0 0 4px;font-size:19px;letter-spacing:-.02em}
        .chipline{display:flex;gap:6px;flex-wrap:wrap}
        .chip{background:#1c1e1c;color:#fff;font-size:9px;font-weight:700;padding:4px 10px;border-radius:999px}
        .chip.ghost{background:#f1f2ef;color:#5a5f58;font-weight:600}
        section{position:relative;z-index:1;padding:2.6mm 0;border-bottom:1px solid #e4e6e0;break-inside:avoid}
        section.tight{padding-bottom:2mm}
        section h2{display:flex;align-items:center;gap:6px;font-size:9.5px;text-transform:uppercase;letter-spacing:.08em;color:#4f8217;margin:0 0 2.4mm;font-weight:800}
        section h2 .bar{width:4px;height:10px;border-radius:2px;background:#6a9c20;display:inline-block}
        .grid{display:grid;grid-template-columns:1fr 1fr;column-gap:9mm;row-gap:2.2mm}
        .f{break-inside:avoid}
        .f small{display:block;color:#8a8f89;font-size:7.3px;text-transform:uppercase;letter-spacing:.06em;margin-bottom:1px}
        .f strong{display:block;font-size:10px;font-weight:650;padding-bottom:1.4mm;border-bottom:1px solid #e9ebe6}
        .muted-note{grid-column:1/-1;color:#8a8f89;font-size:9.5px;margin:0}
        .sign-row{position:relative;z-index:1;display:grid;grid-template-columns:1fr 1fr;gap:16mm;margin-top:20mm}
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
        .cert h1{font-family:"Source Serif 4",Georgia,serif;font-size:25px;font-weight:600;margin:6px 0 8px}
        .cert-rule{width:44px;height:2px;background:#6a9c20;margin:0 auto 12mm}
        .cert p{font-family:"Source Serif 4",Georgia,serif;font-size:13.5px;line-height:1.9;text-align:left;margin:0 0 6mm;color:#26281f}
        .cert-num{font-weight:700;color:#4f8217}
        .pf{position:absolute;left:16mm;right:16mm;bottom:9mm;display:flex;justify-content:space-between;border-top:1px solid #e4e6e0;padding-top:2.5mm;font-size:7.5px;color:#9a9e96;z-index:1}
        .actions{position:fixed;right:18px;bottom:18px;display:flex;gap:8px;z-index:9}
        .actions button{border:0;border-radius:12px;padding:11px 16px;font-weight:750;font-family:inherit;font-size:13px;cursor:pointer}
        .print{background:#4f8217;color:#fff;box-shadow:0 8px 20px rgba(79,130,23,.32)}
        .whatsapp{background:#25D366;color:#fff}
        .close{background:#fff;border:1px solid #d7dad3!important}
        .hint{position:fixed;left:18px;bottom:18px;font-size:11px;color:#5a5f58;background:#fff;padding:8px 12px;border-radius:10px;border:1px solid #d7dad3;max-width:280px;z-index:9}
        @media print{body{background:#fff}.paper{margin:0;box-shadow:none}.actions,.hint{display:none}}
      </style></head>
      <body>${ficha}${receipt}${constancia}
      <div class="hint">Antes de imprimir: en el diálogo de impresión desactivá "Encabezados y pies de página" para que no aparezcan la URL y la fecha del navegador.</div>
      <div class="actions">${phone ? `<button class="whatsapp" onclick="open('https://wa.me/${phone}?text=${encodeURIComponent(waMessage)}','_blank')">WhatsApp</button>` : ""}<button class="close" onclick="close()">Cerrar</button><button class="print" onclick="print()">Imprimir / Guardar PDF</button></div>
      </body></html>`;
  }

  function renderLeads() {
    $("#leadsBody").innerHTML = leads.map((r) => `<tr><td><strong>${esc(r.nombre_contacto)}</strong></td><td>${esc(r.celular_whatsapp)}</td><td>${esc(r.origen || "Otro")}</td><td>${fmtDate(r.created_at)}</td><td>${badge(r.estado || "pendiente")}</td><td><button class="linkbtn" data-lead="${esc(r.id)}">Gestionar</button></td></tr>`).join("") || '<tr><td colspan="6" class="empty">No hay pre-registros. Creá el primero cuando recibas una consulta.</td></tr>';
    $$('[data-lead]').forEach((b) => b.onclick = () => openLead(b.dataset.lead));
  }
  function openLead(id) { const r = leads.find((x) => String(x.id) === String(id)); if (!r) return; leadModal(r); }
  function leadModal(r) {
    const isNew = !r;
    modal(isNew ? "Nuevo pre-registro" : "Gestionar pre-registro", `<div class="formgrid"><div class="formfield"><label>Nombre y apellido</label><input id="leadName" value="${esc(r?.nombre_contacto || "")}"></div><div class="formfield"><label>Celular / WhatsApp</label><input id="leadPhone" value="${esc(r?.celular_whatsapp || "")}"></div><div class="formfield"><label>Origen</label><select id="leadOrigin"><option>Presencial</option><option>WhatsApp</option><option>Llamada</option><option>Referido</option><option>Otro</option></select></div><div class="formfield"><label>Estado</label><select id="leadStatus"><option value="pendiente">Pendiente</option><option value="enviado">Link enviado</option><option value="completado">Completado</option><option value="descartado">Descartado</option></select></div></div><div class="formfield" style="margin-top:12px"><label>Notas</label><textarea id="leadNotes" rows="3" style="width:100%;border:1px solid var(--line);border-radius:12px;padding:10px">${esc(r?.notas || "")}</textarea></div><div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:16px">${isNew ? "" : '<button class="btn" style="background:var(--danger);color:white" id="leadDelete">Eliminar</button><button class="btn btn-secondary" id="leadWhatsApp">Preparar WhatsApp</button>'}<button class="btn btn-primary" id="leadSave">Guardar</button></div>`);
    $("#leadOrigin").value = r?.origen || "Presencial"; $("#leadStatus").value = r?.estado || "pendiente";
    $("#leadSave").onclick = () => { const name = $("#leadName").value.trim(), phone = $("#leadPhone").value.trim(); if (!name || !phone) return toast("Completá nombre y celular"); if (isNew) { r = { id: "lead-" + Date.now(), created_at: now() }; leads.unshift(r); } Object.assign(r, { nombre_contacto: name, celular_whatsapp: phone, origen: $("#leadOrigin").value, estado: $("#leadStatus").value, notas: $("#leadNotes").value.trim(), creado_por: config.administrador }); saveLeads(r); log(`${config.administrador} ${isNew ? "creó" : "actualizó"} el pre-registro de ${name}`); closeModal(); renderAll(); toast("Pre-registro guardado"); };
    if (!isNew) { $("#leadDelete").onclick = () => { if (!confirm("¿Eliminar este pre-registro?")) return; deleteRemote(TABLES.leads, r.id); leads = leads.filter((x) => x !== r); saveLeads(); log(`${config.administrador} eliminó el pre-registro de ${r.nombre_contacto}`); closeModal(); renderAll(); }; $("#leadWhatsApp").classList.add("btn-whatsapp"); $("#leadWhatsApp").onclick = () => { const phone = String(r.celular_whatsapp).replace(/\D/g, "").replace(/^0/, "595"); const base = location.href.replace(/panel\.html.*$/i, "formulario.html"); const link = base + "?" + new URLSearchParams({ nombre: r.nombre_contacto, celular: r.celular_whatsapp }); const msg = (config.mensajeInvitacion || "Hola {nombre}, te compartimos el formulario de admisión: {link}").replaceAll("{nombre}", r.nombre_contacto).replaceAll("{link}", link); r.estado = "enviado"; r.fecha_envio = now(); saveLeads(r); log(`Se preparó el enlace de admisión para ${r.nombre_contacto}`); window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, "_blank"); closeModal(); renderAll(); }; }
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
    $("#membersBody").innerHTML = rows.map((r) => `<tr><td><strong>${esc(r.numero_socio || "s/n")}</strong></td><td><div style="display:flex;align-items:center;gap:9px">${avatarHtml(r, 26)}<span>${esc(nombre(r))}${tipoSocio(r) === "fundador" ? ' <span style="color:var(--green);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em">· Fundador</span>' : ""}</span></div></td><td>${esc(r.cedula || "—")}</td><td>${fmtDate(r.fecha_revision || r.created_at)}</td><td>${r.datos_pendiente_revision ? '<span class="badge pendiente">Por revisar</span>' : badge("activo")}</td><td><button class="linkbtn" data-member="${esc(r.id)}">Abrir ficha</button></td></tr>`).join("") || '<tr><td colspan="6" class="empty">Todavía no hay socios aprobados.</td></tr>';
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
      const list=config.funcionarios||[]; p.innerHTML=head("Funcionarios","Perfiles locales para probar la administración.")+`<div class="formgrid"><div class="formfield"><label>Nombre</label><input id="staffName"></div><div class="formfield"><label>Correo</label><input id="staffEmail" type="email"></div><div class="formfield"><label>Cargo</label><input id="staffRole"></div></div><button class="btn btn-primary" id="staffAdd" style="margin-top:14px">Agregar</button><div class="list" id="staffList" style="margin-top:18px">${list.map((s,i)=>`<div class="item"><div class="item-main"><strong>${esc(s.nombre)}</strong><small>${esc(s.cargo)} · ${esc(s.correo)}</small></div><button class="linkbtn" data-del-staff="${i}">Eliminar</button></div>`).join("")||'<div class="empty">Sin funcionarios.</div>'}</div>`; $("#staffAdd").onclick=()=>{const n=$("#staffName").value.trim(),e=$("#staffEmail").value.trim();if(!n||!e)return toast("Completá nombre y correo");list.push({nombre:n,correo:e,cargo:$("#staffRole").value.trim()||"Funcionario"});config.funcionarios=list;write(KEYS.config,config);renderSetting(name)};$$('[data-del-staff]').forEach(b=>b.onclick=()=>{list.splice(+b.dataset.delStaff,1);config.funcionarios=list;write(KEYS.config,config);renderSetting(name)});return;
    }
    if (name === "roles") { const roles=config.roles||[];p.innerHTML=head("Roles y permisos","Creá niveles de acceso para los futuros usuarios.")+`<div class="formgrid"><div class="formfield"><label>Rol</label><input id="roleName"></div><div class="formfield"><label>Nivel</label><select id="roleLevel"><option>Solo lectura</option><option>Admisiones</option><option>Acceso total</option></select></div></div><button class="btn btn-primary" id="roleAdd" style="margin-top:14px">Crear rol</button><div class="list" style="margin-top:18px">${roles.map(r=>`<div class="item"><div class="item-main"><strong>${esc(r.nombre)}</strong><small>${esc(r.nivel)}</small></div></div>`).join("")||'<div class="empty">Sin roles personalizados.</div>'}</div>`;$("#roleAdd").onclick=()=>{const n=$("#roleName").value.trim();if(!n)return toast("Ingresá un nombre");roles.push({nombre:n,nivel:$("#roleLevel").value});config.roles=roles;write(KEYS.config,config);renderSetting(name)};return; }
    if (name === "admision") { p.innerHTML=head("Admisión","Numeración y parámetros del proceso.")+`<div class="formgrid"><div class="formfield"><label>Próximo N.º de socio</label><input id="nextMember" type="number" value="${config.proximoSocio}"></div><div class="formfield"><label>Administrador</label><input id="adminName" value="${esc(config.administrador)}"></div><div class="formfield"><label>Derecho de admisión</label><input id="fee" type="number" value="${config.derechoAdmision||150000}"></div></div><button class="btn btn-primary" id="saveAdmission" style="margin-top:14px">Guardar</button>`;$("#saveAdmission").onclick=()=>{config.proximoSocio=+$("#nextMember").value||38;config.administrador=$("#adminName").value.trim()||DEFAULTS.administrador;config.derechoAdmision=+$("#fee").value||150000;write(KEYS.config,config);toast("Admisión guardada")};return; }
    if (name === "mensajes") { p.innerHTML=head("Mensajes","Plantilla para enviar el formulario por WhatsApp.")+`<div class="formfield"><label>Invitación</label><textarea id="msgInvite" rows="6" style="width:100%;border:1px solid var(--line);border-radius:12px;padding:10px">${esc(config.mensajeInvitacion||"Hola {nombre}, te compartimos el formulario de admisión: {link}")}</textarea></div><button class="btn btn-primary" id="saveMsg" style="margin-top:14px">Guardar</button>`;$("#saveMsg").onclick=()=>{config.mensajeInvitacion=$("#msgInvite").value;write(KEYS.config,config);toast("Mensaje guardado")};return; }
    if (name === "seguridad") { p.innerHTML=head("Seguridad","Protección local mientras no exista autenticación.")+`<div class="formgrid"><div class="formfield"><label>PIN de 4 a 6 números</label><input id="pin" type="password" maxlength="6" value="${esc(config.pin||"")}"></div><div class="formfield"><label>Confirmar eliminaciones</label><select id="confirmDelete"><option value="1">Sí</option><option value="0">No</option></select></div></div><button class="btn btn-primary" id="saveSecurity" style="margin-top:14px">Guardar</button>`;$("#saveSecurity").onclick=()=>{const v=$("#pin").value;if(v&&!/^\d{4,6}$/.test(v))return toast("PIN inválido");config.pin=v;config.confirmarBorrado=$("#confirmDelete").value==="1";write(KEYS.config,config);toast("Seguridad guardada")};return; }
    if (name === "respaldo") { p.innerHTML=head("Respaldo","Descargá, restaurá o limpiá la base local.")+`<p><strong>${solicitudes.length}</strong> solicitudes · <strong>${leads.length}</strong> pre-registros</p><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-primary" id="backupBtn">Descargar</button><label class="btn btn-secondary">Importar<input id="restoreInput" type="file" accept="application/json" hidden></label><button class="btn" style="background:var(--danger);color:white" id="clearData">Borrar datos</button></div>`;$("#backupBtn").onclick=()=>{const a=document.createElement("a"),blob=new Blob([JSON.stringify({app:"Cimientos Beta Local",solicitudes,leads,actividad,config},null,2)],{type:"application/json"});a.href=URL.createObjectURL(blob);a.download="respaldo-cimientos.json";a.click()};$("#restoreInput").onchange=e=>{const f=e.target.files[0];if(!f)return;const rd=new FileReader();rd.onload=()=>{try{const d=JSON.parse(rd.result);if(d.app!=="Cimientos Beta Local")throw Error("Archivo no válido");solicitudes=d.solicitudes||[];leads=d.leads||[];actividad=d.actividad||[];config=Object.assign({},DEFAULTS,d.config||{});saveSolicitudes();saveLeads();write(KEYS.actividad,actividad);write(KEYS.config,config);renderAll();renderSetting(name)}catch(x){toast(x.message)}};rd.readAsText(f)};$("#clearData").onclick=()=>{if(!confirm("¿Borrar todos los datos locales?"))return;solicitudes=[];leads=[];actividad=[];saveSolicitudes();saveLeads();write(KEYS.actividad,[]);renderAll();renderSetting(name)}; }
  }

  function initials(name) { return String(name || "A").trim().split(/\s+/).slice(0, 2).map(x => x[0]).join("").toUpperCase(); }
  function updateProfileUI() { const p=$("#profileBtn"), av=p.querySelector(".avatar"), strong=p.querySelector("strong"), small=p.querySelector("small"); strong.textContent=config.administrador; small.textContent=config.cargoAdministrador||"Administrador"; av.innerHTML=config.fotoAdministrador?`<img class="profile-photo" src="${config.fotoAdministrador}" alt="">`:esc(initials(config.administrador)); }
  function openProfile() {
    const avatar=config.fotoAdministrador?`<img src="${config.fotoAdministrador}" alt="Foto de perfil">`:esc(initials(config.administrador));
    modal("Mi perfil", `<div class="profile-sheet"><div><div class="profile-avatar-large" id="profilePreview">${avatar}</div><label class="btn btn-secondary" style="display:block;text-align:center;margin-top:9px">Cambiar foto<input type="file" id="profilePhoto" accept="image/*" hidden></label></div><div><div class="formfield"><label>Nombre visible</label><input id="profileName" value="${esc(config.administrador)}"></div><div class="formfield" style="margin-top:12px"><label>Correo</label><input id="profileEmail" type="email" value="${esc(config.correoAdministrador||"")}"></div><div class="formfield" style="margin-top:12px"><label>Rol</label><input id="profileRole" value="${esc(config.cargoAdministrador||"Superadministrador")}"></div><div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px"><button class="btn btn-secondary" id="profileActivity">Ver actividad</button><button class="btn btn-primary" id="profileSave">Guardar perfil</button></div></div></div>`);
    let pendingPhoto=config.fotoAdministrador||""; $("#profilePhoto").onchange=e=>{const f=e.target.files[0];if(!f)return;if(f.size>1500000)return toast("La imagen debe pesar menos de 1,5 MB");const rd=new FileReader();rd.onload=()=>{pendingPhoto=rd.result;$("#profilePreview").innerHTML=`<img src="${pendingPhoto}" alt="Vista previa">`};rd.readAsDataURL(f)};
    $("#profileActivity").onclick=()=>{closeModal();go("actividad")}; $("#profileSave").onclick=()=>{const n=$("#profileName").value.trim();if(!n)return toast("Ingresá tu nombre");config.administrador=n;config.correoAdministrador=$("#profileEmail").value.trim();config.cargoAdministrador=$("#profileRole").value.trim()||"Administrador";config.fotoAdministrador=pendingPhoto;write(KEYS.config,config);updateProfileUI();log("Se actualizó el perfil administrador");closeModal();toast("Perfil guardado")};
  }
  function decorateIcons(){const icons={inicio:'<path d="M3 11 12 3l9 8"/><path d="M5 10v10h14V10M9 20v-6h6v6"/>',solicitudes:'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>',preregistros:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M16 11h6"/>',socios:'<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',actividad:'<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',config:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.09A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.09A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.09A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.14.38.36.72.65 1 .3.28.68.43 1.1.4H21v4h-.09A1.7 1.7 0 0 0 19.4 15Z"/>'};$$('[data-go] .ico').forEach(e=>{const k=e.closest('[data-go]').dataset.go;if(icons[k])e.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true">${icons[k]}</svg>`})}
  $$('[data-go]').forEach((b) => b.addEventListener("click", () => go(b.dataset.go)));
  $$(".filters button").forEach((b) => b.onclick = () => { $$(".filters button").forEach((x) => x.classList.remove("active")); b.classList.add("active"); filter = b.dataset.filter; renderRequests(); });
  $("#requestSearch").oninput = renderRequests; $("#memberSearch").oninput = renderMembers;
  $("#memberTypeFilter").addEventListener("click", (e) => { const b = e.target.closest("[data-member-filter]"); if (!b) return; $$("#memberTypeFilter button").forEach((x) => x.classList.remove("active")); b.classList.add("active"); memberFilter = b.dataset.memberFilter; renderMembers(); });
  $("#addFundador").onclick = () => fundadorModal();
  $("#shareFundadorLink").onclick = () => {
    const base = location.href.replace(/panel\.html.*$/i, "formulario.html");
    const link = base + "?fundador=1";
    const msg = `Hola, te compartimos el link para completar tus datos como socio fundador de la Cooperativa Cimientos: ${link}`;
    navigator.clipboard?.writeText(link).then(() => toast("Link copiado al portapapeles")).catch(() => {});
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
  };
  $("#globalSearch").addEventListener("keydown", (e) => { if (e.key === "Enter") { go("socios"); $("#memberSearch").value = e.target.value; renderMembers(); } });
  $("#newLeadBtn").onclick = () => leadModal(null); $("#modalClose").onclick = closeModal; $("#modalBack").onclick = (e) => { if (e.target === $("#modalBack")) closeModal(); };
  $("#bellBtn").onclick = () => toast(`${solicitudes.filter((r) => r.estado === "pendiente").length + leads.filter((r) => ["pendiente", "enviado"].includes(r.estado)).length} asunto(s) pendiente(s)`);
  $("#profileBtn").onclick = openProfile;
  $("#exportBtn").onclick = () => { const cols = ["numero_solicitud", "apellidos_nombres", "cedula", "celular_whatsapp", "estado", "numero_socio", "resolucion_numero", "created_at"]; const csv = [cols.join(",")].concat(solicitudes.map((r) => cols.map((c) => `"${String(r[c] || "").replace(/"/g, '""')}"`).join(","))).join("\n"); const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); a.download = "solicitudes-cimientos.csv"; a.click(); URL.revokeObjectURL(a.href); log(`${config.administrador} exportó las solicitudes`); };
  $("#printMembers").onclick = () => window.print();
  $("#copySummary").onclick = () => navigator.clipboard?.writeText(`Cimientos: ${solicitudes.filter((r) => r.estado === "pendiente").length} solicitudes pendientes, ${leads.length} pre-registros y ${solicitudes.filter((r) => r.estado === "aprobado").length} socios aprobados.`).then(() => toast("Resumen copiado"));
  const theme = Object.assign({}, DEFAULTS, read(KEYS.theme, {})); applyTheme(theme);
  ["green", "orange", "bg"].forEach((k) => $("#" + k + "Color").oninput = (e) => document.documentElement.style.setProperty("--" + k, e.target.value));
  $("#saveTheme").onclick = () => { const t = { green: $("#greenColor").value, orange: $("#orangeColor").value, bg: $("#bgColor").value }; write(KEYS.theme, t); applyTheme(t); toast("Apariencia guardada"); };
  $("#resetTheme").onclick = () => { localStorage.removeItem(KEYS.theme); applyTheme(DEFAULTS); toast("Paleta restablecida"); };
  $("#themeBtn").onclick = () => { dark = !dark; document.documentElement.style.setProperty("--bg", dark ? "#171918" : $("#bgColor").value); document.documentElement.style.setProperty("--card", dark ? "rgba(37,40,38,.88)" : "rgba(255,255,255,.88)"); document.documentElement.style.setProperty("--ink", dark ? "#f5f5f2" : "#202124"); document.documentElement.style.setProperty("--muted", dark ? "#a8aca8" : "#72767d"); document.documentElement.style.setProperty("--sidebar", dark ? "rgba(28,30,29,.9)" : "rgba(246,247,244,.86)"); };
  // ---------------- Login (desactivado mientras LOGIN_REQUIRED = false) ----------------
  // Con LOGIN_REQUIRED en false (como está hoy) esto no cambia nada: el
  // panel arranca directo, igual que siempre. El día que se active,
  // pide correo/contraseña de Supabase Authentication antes de mostrar
  // el panel, usando el mismo patrón de Ritual Ancestral.
  const loginRequired = typeof LOGIN_REQUIRED !== "undefined" && LOGIN_REQUIRED === true;

  function startApp() {
    $("#today").textContent = new Intl.DateTimeFormat("es-PY", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());
    decorateIcons(); updateProfileUI(); augmentSettings(); renderAll();
    // Si Supabase está configurado, lo local se ve primero (instantáneo)
    // y se actualiza apenas llega la respuesta del servidor.
    cargarDesdeSupabase();
  }

  async function initAuthGate() {
    if (!loginRequired || !supabaseClient) { startApp(); return; }
    const loginScreen = $("#loginScreen");
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
