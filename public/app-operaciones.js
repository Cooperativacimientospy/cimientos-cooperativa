(function () {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const today = () => new Date().toISOString().slice(0, 10);
  const now = () => new Date().toISOString();
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `op-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const fmtDate = (v) => v ? new Intl.DateTimeFormat("es-PY", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(`${String(v).slice(0, 10)}T12:00:00`)) : "—";
  const fmtGs = (v) => `Gs. ${(Number(v) || 0).toLocaleString("es-PY")}`;
  const parseNumber = (v) => Number(String(v == null ? "" : v).replace(/[^0-9-]/g, "")) || 0;
  const formatNumber = (v) => parseNumber(v).toLocaleString("es-PY");
  const memberName = (m) => m ? (m.apellidos_nombres || m.nombre || "Sin nombre") : "—";
  const key = "cimientos_operaciones_v1";
  const blank = { tareas: [], documentos: [], resoluciones: [], aportes: [], campanias: [] };
  const tables = { tareas: "tareas_operativas", documentos: "documentos_socios", resoluciones: "resoluciones_consejo", aportes: "movimientos_aportes", campanias: "campanias" };
  const cloudConfigured = typeof SUPABASE_URL !== "undefined" && typeof SUPABASE_ANON_KEY !== "undefined" && SUPABASE_URL && SUPABASE_ANON_KEY && !String(SUPABASE_URL).startsWith("PONE_ACA") && !String(SUPABASE_ANON_KEY).startsWith("PONE_ACA");
  const client = window.cimientosSupabase || (cloudConfigured && window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null);
  let backendOperativo = !!client;
  let state = readLocal();
  let socios = [];
  let solicitudes = [];
  let preregistros = [];
  let reportPeriod = today().slice(0, 7);
  let contributionSearch = "";
  let contributionYear = today().slice(0, 4);

  function readLocal() {
    try { return Object.assign({}, blank, JSON.parse(localStorage.getItem(key) || "{}")); }
    catch (_) { return Object.assign({}, blank); }
  }
  function saveLocal() { localStorage.setItem(key, JSON.stringify(state)); }
  function toast(text) {
    const el = $("#toast");
    if (!el) return;
    el.textContent = text; el.classList.add("show");
    setTimeout(() => el.classList.remove("show"), 2400);
  }
  function friendlyError(error, fallback) {
    const msg = String(error && (error.message || error.details || error) || "");
    if (/duplicate|unique/i.test(msg)) return "Ese registro ya existe.";
    if (/permission|row-level|policy|rls/i.test(msg)) return "Tu usuario no tiene permisos para realizar esta acción.";
    if (/relation .* does not exist|schema cache|could not find the table/i.test(msg)) return "El módulo todavía no fue activado en la base de datos.";
    return fallback;
  }
  function card(content, cls = "") { return `<div class="card panel ${cls}">${content}</div>`; }
  function empty(text) { return `<div class="empty op-empty"><strong>Sin registros</strong><span>${esc(text)}</span></div>`; }
  function status(value) {
    const labels = { pendiente: "Pendiente", en_curso: "En curso", completada: "Completada", faltante: "Faltante", observado: "Observado", aprobado: "Aprobado", vigente: "Vigente", anulada: "Anulada", borrador: "Borrador", emitida: "Emitida", planificada: "Planificada", activa: "Activa", finalizada: "Finalizada" };
    return `<span class="badge ${esc(value === "aprobado" || value === "vigente" || value === "completada" ? "activo" : value === "observado" ? "observada" : "pendiente")}">${esc(labels[value] || value || "Pendiente")}</span>`;
  }
  function currentUser() {
    const p = $("#profileBtn strong");
    return p ? p.textContent.trim() : "Administrador";
  }
  function syncCoreData() {
    if (window.cimientosData) {
      solicitudes = window.cimientosData.solicitudes() || solicitudes;
      preregistros = window.cimientosData.preregistros() || preregistros;
      socios = solicitudes.filter((r) => r.estado === "aprobado");
    }
  }
  function memberOptions(selected = "") {
    syncCoreData();
    return `<option value="">Seleccioná un socio</option>${socios.map((m) => `<option value="${esc(m.id)}"${String(m.id) === String(selected) ? " selected" : ""}>N.º ${esc(m.numero_socio || "s/n")} · ${esc(memberName(m))}</option>`).join("")}`;
  }
  function memberSearchLabel(m) {
    return `N.º ${m.numero_socio || "s/n"} · ${memberName(m)} · C.I. ${m.cedula || "s/d"}`;
  }
  async function nextReceiptNumber() {
    if (client && backendOperativo) {
      const result = await client.rpc("fn_siguiente_numero_recibo");
      if (!result.error && result.data) return String(result.data);
    }
    const highest = state.aportes.reduce((max, row) => {
      const digits = String(row.recibo_numero || "").match(/(\d+)$/);
      return Math.max(max, digits ? Number(digits[1]) : 0);
    }, 0);
    return `REC-${String(highest + 1).padStart(6, "0")}`;
  }
  function bindMoneyInputs(root) {
    $$(`${root} [data-money]`).forEach((input) => {
      const refresh = () => { input.value = formatNumber(input.value); };
      input.addEventListener("focus", () => { input.value = String(parseNumber(input.value)); input.select(); });
      input.addEventListener("blur", refresh);
      refresh();
    });
  }
  function findMember(id) { syncCoreData(); return socios.find((m) => String(m.id) === String(id)); }
  async function markMemberPaid(member, payment) {
    if (member.pago_confirmado) return;
    const patch = { pago_confirmado: true, recibo_numero: payment.recibo_numero, fecha_pago: payment.fecha_pago, forma_pago: payment.forma_pago };
    Object.assign(member, patch);
    if (client && backendOperativo) {
      const result = await client.from("solicitudes_socios").update(patch).eq("id", member.id);
      if (result.error) throw result.error;
    } else {
      localStorage.setItem("cimientos_local_v1_solicitudes", JSON.stringify(solicitudes));
    }
  }
  function modal(title, html) { $("#opModalTitle").textContent = title; $("#opModalBody").innerHTML = html; $("#opModalBack").classList.add("open"); }
  function closeModal() { $("#opModalBack").classList.remove("open"); }
  function formActions(label) { return `<div class="op-form-actions"><button type="button" class="btn btn-secondary" data-op-cancel>Cancelar</button><button type="submit" class="btn btn-primary">${esc(label)}</button></div>`; }
  function bindFormCancel() { $$('[data-op-cancel]').forEach((b) => b.onclick = closeModal); }

  async function loadBaseData() {
    if (client) {
      const [s, l] = await Promise.all([
        client.from("solicitudes_socios").select("*").order("created_at", { ascending: false }),
        client.from("pre_registros").select("*").order("created_at", { ascending: false })
      ]);
      if (!s.error) solicitudes = s.data || [];
      if (!l.error) preregistros = l.data || [];
    }
    if (!solicitudes.length) solicitudes = JSON.parse(localStorage.getItem("cimientos_local_v1_solicitudes") || "[]");
    if (!preregistros.length) preregistros = JSON.parse(localStorage.getItem("cimientos_local_v1_preregistros") || "[]");
    socios = solicitudes.filter((r) => r.estado === "aprobado");
  }
  async function loadOperations() {
    if (!client) { backendOperativo = false; return; }
    const results = await Promise.all(Object.entries(tables).map(async ([name, table]) => [name, await client.from(table).select("*").order("created_at", { ascending: false })]));
    const missing = results.some(([, result]) => result.error && /does not exist|schema cache|could not find/i.test(result.error.message || ""));
    backendOperativo = !missing;
    results.forEach(([name, result]) => { if (!result.error && Array.isArray(result.data)) state[name] = result.data; });
    saveLocal();
  }
  async function persist(collection, row) {
    row.updated_at = now();
    const idx = state[collection].findIndex((x) => x.id === row.id);
    if (idx >= 0) state[collection][idx] = row; else state[collection].unshift(row);
    saveLocal();
    if (client && backendOperativo) {
      const { error } = await client.from(tables[collection]).upsert(row);
      if (error) throw error;
    }
  }
  function backendNotice() {
    return backendOperativo ? "" : `<div class="op-notice"><strong>Modo de preparación local</strong><span>Los registros se guardan en este navegador. Para trabajar entre varios funcionarios, aplicá la migración <code>supabase-migracion-p1-operaciones.sql</code>.</span></div>`;
  }
  function mobileOpsNav(active) {
    const items = [["tareas","Tareas"],["documentos","Documentos"],["resoluciones","Resoluciones"],["aportes","Aportes"],["basedatos","Base de datos"],["reportes","Reportes"]];
    return `<div class="mobile-op-nav">${items.map(([id,label])=>`<button data-mobile-go="${id}" class="${id===active?"active":""}">${label}</button>`).join("")}</div>`;
  }

  function renderTasks() {
    const pending = state.tareas.filter((t) => t.estado !== "completada");
    const overdue = pending.filter((t) => t.fecha_vencimiento && t.fecha_vencimiento < today());
    $("#opTasks").innerHTML = backendNotice() + `<div class="op-kpis"><div class="card op-kpi"><span>Pendientes</span><strong>${pending.length}</strong></div><div class="card op-kpi"><span>Vencidas</span><strong>${overdue.length}</strong></div><div class="card op-kpi"><span>Completadas</span><strong>${state.tareas.length - pending.length}</strong></div></div>` + card(state.tareas.length ? `<div class="op-list">${state.tareas.map((t) => { const m = findMember(t.socio_id); return `<button class="op-row" data-task-id="${esc(t.id)}"><span class="op-priority ${esc(t.prioridad || "normal")}"></span><span><strong>${esc(t.titulo)}</strong><small>${esc(m ? memberName(m) : t.referencia || "Tarea general")} · ${esc(t.responsable || "Sin asignar")}</small></span><span class="op-row-end"><small>${fmtDate(t.fecha_vencimiento)}</small>${status(t.estado)}</span></button>`; }).join("")}</div>` : empty("Creá una tarea para comenzar a organizar el trabajo diario."));
    $("#opTasks").insertAdjacentHTML("afterbegin", mobileOpsNav("tareas"));
    $$('[data-task-id]').forEach((b) => b.onclick = () => openTask(state.tareas.find((t) => t.id === b.dataset.taskId)));
  }
  function openTask(existing) {
    const t = existing || { id: uuid(), titulo: "", socio_id: "", responsable: currentUser(), fecha_vencimiento: today(), prioridad: "normal", estado: "pendiente", created_at: now() };
    modal(existing ? "Editar tarea" : "Nueva tarea", `<form id="opTaskForm" class="op-form"><label class="op-wide">Tarea<input required name="titulo" value="${esc(t.titulo)}"></label><label>Socio relacionado<select name="socio_id">${memberOptions(t.socio_id)}</select></label><label>Responsable<input name="responsable" value="${esc(t.responsable)}"></label><label>Vencimiento<input type="date" name="fecha_vencimiento" value="${esc(t.fecha_vencimiento)}"></label><label>Prioridad<select name="prioridad"><option value="normal">Normal</option><option value="alta"${t.prioridad === "alta" ? " selected" : ""}>Alta</option><option value="urgente"${t.prioridad === "urgente" ? " selected" : ""}>Urgente</option></select></label><label>Estado<select name="estado"><option value="pendiente">Pendiente</option><option value="en_curso"${t.estado === "en_curso" ? " selected" : ""}>En curso</option><option value="completada"${t.estado === "completada" ? " selected" : ""}>Completada</option></select></label>${formActions("Guardar tarea")}</form>`);
    bindFormCancel();
    $("#opTaskForm").onsubmit = async (e) => { e.preventDefault(); const v = Object.fromEntries(new FormData(e.target)); try { await persist("tareas", Object.assign(t, v)); closeModal(); renderTasks(); renderReports(); toast("Tarea guardada"); } catch (err) { toast(friendlyError(err, "No se pudo guardar la tarea")); } };
  }

  function renderDocuments() {
    const rows = state.documentos;
    $("#opDocuments").innerHTML = backendNotice() + card(rows.length ? `<div class="tablewrap"><table class="table"><thead><tr><th>Socio</th><th>Documento</th><th>Estado</th><th>Vencimiento</th><th>Registrado por</th></tr></thead><tbody>${rows.map((d) => `<tr><td>${esc(memberName(findMember(d.socio_id)))}</td><td><strong>${esc(d.tipo)}</strong>${d.nombre_archivo ? `<small class="op-block">${esc(d.nombre_archivo)}</small>` : ""}</td><td>${status(d.estado)}</td><td>${fmtDate(d.fecha_vencimiento)}</td><td>${esc(d.registrado_por || "—")}</td></tr>`).join("")}</tbody></table></div>` : empty("Registrá los documentos que integran cada expediente."));
    $("#opDocuments").insertAdjacentHTML("afterbegin", mobileOpsNav("documentos"));
  }
  function openDocument() {
    if (!socios.length) return toast("Primero necesitás un socio aprobado para registrar documentos.");
    modal("Registrar documento", `<form id="opDocumentForm" class="op-form"><label>Socio<select required name="socio_id">${memberOptions()}</select></label><label>Tipo<select name="tipo"><option>Cédula de identidad</option><option>Solicitud firmada</option><option>Comprobante de domicilio</option><option>Comprobante de ingresos</option><option>Resolución del Consejo</option><option>Otro</option></select></label><label>Estado<select name="estado"><option value="vigente">Vigente</option><option value="observado">Observado</option><option value="faltante">Faltante</option></select></label><label>Vencimiento<input type="date" name="fecha_vencimiento"></label><label class="op-wide">Archivo<input type="file" id="opDocumentFile" accept=".pdf,image/*"></label><label class="op-wide">Observaciones<textarea name="observaciones" rows="3"></textarea></label>${formActions("Registrar documento")}</form>`);
    bindFormCancel();
    $("#opDocumentForm").onsubmit = async (e) => { e.preventDefault(); const v = Object.fromEntries(new FormData(e.target)); const file = $("#opDocumentFile").files[0]; const row = Object.assign(v, { id: uuid(), registrado_por: currentUser(), created_at: now(), nombre_archivo: file ? file.name : "" }); try { if (file && client && backendOperativo) { const path = `${v.socio_id}/${row.id}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`; const upload = await client.storage.from("expedientes").upload(path, file, { upsert: false }); if (upload.error) throw upload.error; row.storage_path = path; } else if (file && !backendOperativo) { throw Error("El archivo requiere Supabase activo"); } await persist("documentos", row); closeModal(); renderDocuments(); toast("Documento registrado"); } catch (err) { toast(friendlyError(err, "No se pudo guardar el documento")); } };
  }

  function renderResolutions() {
    $("#opResolutions").innerHTML = backendNotice() + card(state.resoluciones.length ? `<div class="tablewrap"><table class="table"><thead><tr><th>N.º</th><th>Fecha</th><th>Sesión</th><th>Decisión</th><th>Socio</th><th>Estado</th></tr></thead><tbody>${state.resoluciones.map((r) => `<tr><td><strong>${esc(r.numero)}</strong></td><td>${fmtDate(r.fecha)}</td><td>${esc(r.sesion || "—")}</td><td>${esc(r.decision)}</td><td>${esc(memberName(findMember(r.socio_id)))}</td><td>${status(r.estado)}</td></tr>`).join("")}</tbody></table></div>` : empty("Registrá las decisiones adoptadas por el Consejo."));
    $("#opResolutions").insertAdjacentHTML("afterbegin", mobileOpsNav("resoluciones"));
  }
  function nextLocalResolutionNumber() {
    const year = today().slice(0, 4);
    const highest = state.resoluciones.reduce((max, row) => {
      const match = String(row.numero || "").match(/^RES-(\d+)\/(\d{4})$/i);
      return match && match[2] === year ? Math.max(max, Number(match[1])) : max;
    }, 0);
    return `RES-${String(highest + 1).padStart(4, "0")}/${year}`;
  }
  function openResolution() {
    const preview = client && backendOperativo ? `Automático · RES-0001/${today().slice(0, 4)}` : nextLocalResolutionNumber();
    modal("Nueva resolución", `<form id="opResolutionForm" class="op-form"><label>Número<input readonly id="opResolutionNumber" value="${esc(preview)}"><small class="op-field-help">Se confirma en el servidor al guardar y nunca se repite.</small></label><label>Fecha de sesión<input required type="date" name="fecha" value="${today()}"></label><label>Sesión<input name="sesion" placeholder="Ordinaria / Acta N.º"></label><label>Socio relacionado<select name="socio_id">${memberOptions()}</select></label><label>Decisión<select name="decision"><option>Admisión aprobada</option><option>Admisión rechazada</option><option>Admisión observada</option><option>Resolución general</option></select></label><label>Estado<select name="estado"><option value="emitida">Emitida</option><option value="borrador">Borrador</option><option value="anulada">Anulada</option></select></label><label class="op-wide">Fundamento y observaciones<textarea required name="detalle" rows="4"></textarea></label>${formActions("Guardar resolución")}</form>`);
    bindFormCancel();
    $("#opResolutionForm").onsubmit = async (e) => { e.preventDefault(); const v = Object.fromEntries(new FormData(e.target)); try { if (client && backendOperativo) { const result = await client.rpc("fn_siguiente_numero_resolucion", { p_anio: Number(String(v.fecha).slice(0, 4)) }); if (result.error) throw result.error; v.numero = result.data; } else { v.numero = nextLocalResolutionNumber(); } await persist("resoluciones", Object.assign(v, { id: uuid(), creado_por: currentUser(), created_at: now() })); closeModal(); renderResolutions(); renderReports(); toast(`Resolución ${v.numero} guardada`); } catch (err) { toast(friendlyError(err, "No se pudo guardar la resolución")); } };
  }

  function contributionTotals() {
    return state.aportes.filter((m) => m.estado !== "anulada").reduce((a, m) => { a.aporte += Number(m.aporte) || 0; a.solidaridad += Number(m.solidaridad) || 0; a.otros += Number(m.otros) || 0; return a; }, { aporte: 0, solidaridad: 0, otros: 0 });
  }
  function memberMatches(m, query) {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return true;
    return `${memberName(m)} ${m.cedula || ""} ${m.numero_socio || ""} ${m.celular_whatsapp || m.celular || ""}`.toLowerCase().includes(q);
  }
  function accountMovements(memberId, year) {
    return state.aportes.filter((m) => m.estado !== "anulada" && String(m.socio_id) === String(memberId) && String(m.periodo || "").startsWith(year)).sort((a, b) => String(b.periodo).localeCompare(String(a.periodo)));
  }
  function openMemberAccount(member, year = contributionYear) {
    const movements = accountMovements(member.id, year);
    const byMonth = new Map(movements.map((m) => [String(m.periodo).slice(5, 7), m]));
    const months = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
    const totals = movements.reduce((a, m) => ({ aporte: a.aporte + (+m.aporte || 0), solidaridad: a.solidaridad + (+m.solidaridad || 0), total: a.total + (+m.aporte || 0) + (+m.solidaridad || 0) + (+m.otros || 0) }), { aporte: 0, solidaridad: 0, total: 0 });
    const years = Array.from(new Set([today().slice(0,4), ...state.aportes.map((m) => String(m.periodo || "").slice(0,4)).filter(Boolean)])).sort().reverse();
    modal("Cuenta individual", `<div class="op-account-head"><div><span>Socio N.º ${esc(member.numero_socio || "s/n")}</span><h3>${esc(memberName(member))}</h3><small>C.I. ${esc(member.cedula || "—")}</small></div><label>Año<select id="opAccountYear">${years.map((y) => `<option value="${esc(y)}"${y === year ? " selected" : ""}>${esc(y)}</option>`).join("")}</select></label></div><div class="op-account-summary"><div><span>Aportes</span><strong>${fmtGs(totals.aporte)}</strong></div><div><span>Solidaridad</span><strong>${fmtGs(totals.solidaridad)}</strong></div><div><span>Total registrado</span><strong>${fmtGs(totals.total)}</strong></div></div><div class="op-month-grid">${months.map((label, i) => { const key = String(i + 1).padStart(2, "0"), movement = byMonth.get(key); return `<div class="op-month ${movement ? "paid" : "pending"}"><span>${label}</span><strong>${movement ? "Pagado" : "Pendiente"}</strong>${movement ? `<small>${esc(movement.recibo_numero || "")}</small>` : ""}</div>`; }).join("")}</div>${movements.length ? `<div class="tablewrap op-account-table"><table class="table"><thead><tr><th>Periodo</th><th>Recibo</th><th>Aporte</th><th>Solidaridad</th><th>Total</th><th></th></tr></thead><tbody>${movements.map((m) => `<tr><td>${esc(m.periodo)}</td><td>${esc(m.recibo_numero)}</td><td>${fmtGs(m.aporte)}</td><td>${fmtGs(m.solidaridad)}</td><td>${fmtGs((+m.aporte || 0)+(+m.solidaridad || 0)+(+m.otros || 0))}</td><td><button class="linkbtn" data-account-receipt="${esc(m.id)}">Recibo</button></td></tr>`).join("")}</tbody></table></div>` : empty(`No hay pagos registrados en ${year}.`)}`);
    $("#opAccountYear").onchange = (e) => openMemberAccount(member, e.target.value);
    $$('[data-account-receipt]').forEach((b) => b.onclick = () => printContribution(state.aportes.find((m) => m.id === b.dataset.accountReceipt)));
  }
  function renderContributions() {
    syncCoreData();
    const totals = contributionTotals();
    const years = Array.from(new Set([today().slice(0,4), ...state.aportes.map((m) => String(m.periodo || "").slice(0,4)).filter(Boolean)])).sort().reverse();
    const filteredMembers = socios.filter((m) => memberMatches(m, contributionSearch)).slice(0, 20);
    const filteredMovements = state.aportes.filter((m) => String(m.periodo || "").startsWith(contributionYear) && memberMatches(findMember(m.socio_id), contributionSearch));
    const memberResults = contributionSearch ? `<div class="op-member-results">${filteredMembers.length ? filteredMembers.map((m) => { const paid = accountMovements(m.id, contributionYear).length; return `<button class="op-member-result" data-account-member="${esc(m.id)}"><span><strong>${esc(memberName(m))}</strong><small>N.º ${esc(m.numero_socio || "s/n")} · C.I. ${esc(m.cedula || "—")}</small></span><span class="badge ${paid ? "activo" : "pendiente"}">${paid} mes(es)</span></button>`; }).join("") : empty("No encontramos socios con esos datos.")}</div>` : "";
    $("#opContributions").innerHTML = backendNotice() + `<div class="op-kpis"><div class="card op-kpi"><span>Aportes registrados</span><strong>${fmtGs(totals.aporte)}</strong></div><div class="card op-kpi"><span>Fondo de solidaridad</span><strong>${fmtGs(totals.solidaridad)}</strong></div><div class="card op-kpi"><span>Movimientos</span><strong>${state.aportes.length}</strong></div></div>` + card(`<div class="op-contribution-toolbar"><label class="op-search-label">Buscar socio<input class="field" id="opContributionSearch" value="${esc(contributionSearch)}" placeholder="Nombre, cédula, número o teléfono…"></label><label>Año<select class="field" id="opContributionYear">${years.map((y) => `<option value="${esc(y)}"${y === contributionYear ? " selected" : ""}>${esc(y)}</option>`).join("")}</select></label></div>${memberResults}${filteredMovements.length ? `<div class="tablewrap"><table class="table"><thead><tr><th>Recibo</th><th>Socio</th><th>Periodo</th><th>Aporte</th><th>Solidaridad</th><th>Total</th><th></th></tr></thead><tbody>${filteredMovements.map((m) => `<tr><td>${esc(m.recibo_numero)}</td><td><button class="op-member-link" data-account-member="${esc(m.socio_id)}">${esc(memberName(findMember(m.socio_id)))}</button></td><td>${esc(m.periodo)}</td><td>${fmtGs(m.aporte)}</td><td>${fmtGs(m.solidaridad)}</td><td><strong>${fmtGs((+m.aporte || 0) + (+m.solidaridad || 0) + (+m.otros || 0))}</strong></td><td><button class="linkbtn" data-print-contribution="${esc(m.id)}">Recibo</button></td></tr>`).join("")}</tbody></table></div>` : empty("No hay movimientos para los filtros seleccionados.")}`);
    $("#opContributions").insertAdjacentHTML("afterbegin", mobileOpsNav("aportes"));
    $$('[data-print-contribution]').forEach((b) => b.onclick = () => printContribution(state.aportes.find((m) => m.id === b.dataset.printContribution)));
    $$('[data-account-member]').forEach((b) => b.onclick = () => { const m = findMember(b.dataset.accountMember); if (m) openMemberAccount(m); });
    $("#opContributionSearch").oninput = (e) => { contributionSearch = e.target.value; renderContributions(); const input = $("#opContributionSearch"); input.focus(); input.setSelectionRange(input.value.length, input.value.length); };
    $("#opContributionYear").onchange = (e) => { contributionYear = e.target.value; renderContributions(); };
  }
  async function openContribution() {
    if (!socios.length) return toast("Primero necesitás un socio aprobado para registrar un pago.");
    const month = today().slice(0, 7);
    const receipt = await nextReceiptNumber();
    const memberList = socios.map((m) => `<option value="${esc(memberSearchLabel(m))}"></option>`).join("");
    modal("Registrar pago", `<form id="opContributionForm" class="op-form"><label class="op-wide">Buscar socio<input required id="opContributionMember" list="opContributionMembers" autocomplete="off" placeholder="Nombre, cédula o número de socio…"><datalist id="opContributionMembers">${memberList}</datalist><small class="op-field-help">Escribí cualquier dato y seleccioná al socio correcto.</small></label><label>Periodo<input required type="month" name="periodo" value="${month}"></label><label>Fecha de pago<input required type="date" name="fecha_pago" value="${today()}"></label><label>Aporte (Gs.)<input required inputmode="numeric" data-money name="aporte" value="30.000"></label><label>Solidaridad (Gs.)<input required inputmode="numeric" data-money name="solidaridad" value="20.000"></label><label>Otros conceptos (Gs.)<input inputmode="numeric" data-money name="otros" value="0"></label><label>Forma de pago<select name="forma_pago"><option>Transferencia</option><option>Efectivo</option><option>Depósito</option><option>Otro</option></select></label><label>Número de recibo<input required readonly name="recibo_numero" value="${receipt}"><small class="op-field-help">Asignado automáticamente por el sistema.</small></label><label class="op-wide">Observaciones<textarea name="observaciones" rows="3"></textarea></label>${formActions("Confirmar pago")}</form>`);
    bindFormCancel();
    bindMoneyInputs("#opContributionForm");
    $("#opContributionForm").onsubmit = async (e) => { e.preventDefault(); const v = Object.fromEntries(new FormData(e.target)); const memberQuery = $("#opContributionMember").value.trim().toLowerCase(); const socio = socios.find((m) => memberSearchLabel(m).toLowerCase() === memberQuery); if (!socio) return toast("Seleccioná un socio de la lista de resultados."); const row = Object.assign(v, { socio_id: socio.id, id: uuid(), estado: "vigente", registrado_por: currentUser(), created_at: now(), aporte: parseNumber(v.aporte), solidaridad: parseNumber(v.solidaridad), otros: parseNumber(v.otros) }); try { await persist("aportes", row); await markMemberPaid(socio, row); closeModal(); renderContributions(); renderReports(); toast("Pago registrado y comprobante generado"); printContribution(row); } catch (err) { toast(friendlyError(err, "No se pudo registrar el pago")); } };
  }
  function institutionalPrint(title, body, code, share) {
    const w = window.open("", "_blank", "width=920,height=950");
    if (!w) return toast("Habilitá las ventanas emergentes para imprimir.");
    const logo = new URL("assets/logo-cimientos.png", location.href).href;
    const wa = share && share.phone ? `<button class="whatsapp" onclick="open('https://web.whatsapp.com/send?phone=${String(share.phone).replace(/\D/g, "")}&text=${encodeURIComponent(share.message || "")}', '_blank', 'noopener,noreferrer')">Preparar WhatsApp</button>` : "";
    w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(title)}</title><link rel="stylesheet" href="${new URL("fonts.css", location.href).href}"><style>@page{size:A4;margin:12mm 14mm 14mm}*{box-sizing:border-box}body{font-family:"Nunito Sans",sans-serif;color:#222;margin:0;padding:12mm 14mm 14mm}.head{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #3c3e3b;padding-bottom:8px;margin-bottom:18px}.head img{width:178px;height:auto}.head div{text-align:right}.head strong{display:block;color:#5c8d1d;text-transform:uppercase;letter-spacing:.07em;font-size:12px}.head small{color:#70746f}.meta{display:flex;justify-content:space-between;color:#777;font-size:10px;margin-bottom:18px}.foot{position:fixed;bottom:8mm;left:14mm;right:14mm;border-top:1px solid #ddd;padding-top:6px;font-size:9px;color:#777;display:flex;justify-content:space-between}h1{font-size:23px;margin:0 0 4px}.receipt-intro{display:flex;justify-content:space-between;align-items:flex-end;margin:0 0 18px}.receipt-intro p{margin:4px 0 0;color:#70746f;font-size:11px}.receipt-number{border-radius:999px;background:#eef4e3;color:#56851d;padding:8px 12px;font-size:12px;font-weight:800}table{width:100%;border-collapse:collapse}thead{display:table-header-group}tr{break-inside:avoid}th{text-align:left;color:#6a6f69;text-transform:uppercase;font-size:8px;letter-spacing:.05em;border-bottom:1.5px solid #333;padding:8px 6px}td{font-size:10px;border-bottom:1px solid #e5e6e2;padding:9px 6px}.box{border:1px solid #b9bdb5;border-radius:18px;padding:20px;background:linear-gradient(145deg,#fff,#fafbf8)}.receipt-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 28px}.receipt-item{padding:10px 0;border-bottom:1px solid #e4e6e0}.receipt-item small{display:block;color:#7b8078;text-transform:uppercase;letter-spacing:.06em;font-size:8px;margin-bottom:3px}.receipt-item strong{font-size:12px}.signs{display:grid;grid-template-columns:1fr 1fr;align-items:end;gap:28px;margin-top:65px;text-align:center;font-size:10px;color:#666}.sign{border-top:1px solid #333;padding-top:6px}.total{display:flex;justify-content:space-between;align-items:center;border-top:1px dashed #bbb;margin-top:18px;padding-top:15px;font-size:17px;font-weight:800}.total span:last-child{font-size:22px;color:#56851d}.receipt-note{font-size:9px;line-height:1.55;color:#70746f;margin-top:18px}.doc-actions{position:fixed;right:18px;bottom:18px;display:flex;gap:8px}.doc-actions button{border:0;border-radius:16px;padding:10px 15px;font:700 12px "Nunito Sans";cursor:pointer}.doc-actions .primary{background:#65961f;color:#fff}.doc-actions .secondary{background:#fff;border:1px solid #ddd}.doc-actions .whatsapp{background:#25D366;color:#fff}@media print{body{padding:0}.doc-actions{display:none}.foot{bottom:0;left:0;right:0}}</style></head><body><header class="head"><img src="${logo}" alt="Cooperativa Cimientos"><div><strong>${esc(title)}</strong><small>Cooperativa Cimientos Ltda.</small></div></header><div class="meta"><span>Emitido: ${new Intl.DateTimeFormat("es-PY", { dateStyle: "long", timeStyle: "short" }).format(new Date())}</span><span>${esc(code || "")}</span></div>${body}<footer class="foot"><span>Cooperativa Cimientos Ltda. · Documento generado por el sistema</span><span>${esc(code || "")}</span></footer><div class="doc-actions">${wa}<button class="secondary" onclick="close()">Cerrar</button><button class="primary" onclick="print()">Imprimir / Guardar PDF</button></div></body></html>`);
    w.document.close();
  }
  function printContribution(m) {
    const socio = findMember(m.socio_id); const total = (+m.aporte || 0) + (+m.solidaridad || 0) + (+m.otros || 0);
    const phone = socio && (socio.celular_whatsapp || socio.celular);
    institutionalPrint("Comprobante de pago", `<div class="receipt-intro"><div><h1>Recibo de aportes y solidaridad</h1><p>Periodo ${esc(m.periodo)} · Pago registrado el ${fmtDate(m.fecha_pago)}</p></div><span class="receipt-number">${esc(m.recibo_numero)}</span></div><div class="box"><div class="receipt-grid"><div class="receipt-item"><small>Recibí de</small><strong>${esc(memberName(socio))}</strong></div><div class="receipt-item"><small>Socio N.º</small><strong>${esc(socio && socio.numero_socio || "—")}</strong></div><div class="receipt-item"><small>Cédula de identidad</small><strong>${esc(socio && socio.cedula || "—")}</strong></div><div class="receipt-item"><small>Forma de pago</small><strong>${esc(m.forma_pago)}</strong></div><div class="receipt-item"><small>Aporte</small><strong>${fmtGs(m.aporte)}</strong></div><div class="receipt-item"><small>Solidaridad</small><strong>${fmtGs(m.solidaridad)}</strong></div>${Number(m.otros) ? `<div class="receipt-item"><small>Otros conceptos</small><strong>${fmtGs(m.otros)}</strong></div>` : ""}</div><div class="total"><span>Total recibido</span><span>${fmtGs(total)}</span></div></div><p class="receipt-note">Este comprobante acredita el pago registrado en el sistema de la Cooperativa Cimientos Ltda. Conservá el número de recibo para cualquier consulta.</p><div class="signs"><div class="sign">Recibí conforme — Socio</div><div class="sign">Firma y sello — Tesorería</div></div>`, m.recibo_numero, { phone, message: `Hola ${memberName(socio)}. Registramos tu pago correspondiente al periodo ${m.periodo}, recibo ${m.recibo_numero}, por ${fmtGs(total)}. Te enviamos el comprobante en PDF.` });
  }

  function allContacts() {
    syncCoreData();
    const seen = new Set(); const out = [];
    [...socios.map((m) => ({ id: `s-${m.id}`, nombre: memberName(m), cedula: m.cedula, telefono: m.celular_whatsapp || m.celular, correo: m.correo_electronico, tipo: "Socio activo", ciudad: m.ciudad, barrio: m.barrio, no_contactar: !!m.no_contactar })), ...preregistros.map((p) => ({ id: `p-${p.id}`, nombre: p.nombre_contacto, telefono: p.celular_whatsapp, correo: p.correo, tipo: "Pre-registro", origen: p.origen, no_contactar: !!p.no_contactar }))].forEach((c) => { const token = c.cedula || String(c.telefono || "").replace(/\D/g, "") || c.correo || c.id; if (!seen.has(token)) { seen.add(token); out.push(c); } });
    return out;
  }
  function renderDatabase() {
    const contacts = allContacts(); const available = contacts.filter((c) => !c.no_contactar);
    $("#opDatabase").innerHTML = `<div class="op-kpis"><div class="card op-kpi"><span>Contactos únicos</span><strong>${contacts.length}</strong></div><div class="card op-kpi"><span>Contactables</span><strong>${available.length}</strong></div><div class="card op-kpi"><span>Listas de comunicación</span><strong>${state.campanias.length}</strong></div></div>` + card(`<div class="toolbar"><input class="field" id="opContactSearch" placeholder="Buscar contacto…"><select class="field" id="opContactType"><option value="todos">Todos</option><option value="Socio activo">Socios activos</option><option value="Pre-registro">Pre-registros</option></select></div><div class="tablewrap"><table class="table"><thead><tr><th>Contacto</th><th>Tipo</th><th>Teléfono</th><th>Correo</th><th>Ubicación</th></tr></thead><tbody id="opContactsBody"></tbody></table></div>`) + card(`<div class="panel-head"><div><h2>Listas de comunicación</h2><small class="op-block">Organizan avisos, convocatorias o seguimientos. El sistema no envía mensajes automáticamente.</small></div></div>${state.campanias.length ? `<div class="op-list">${state.campanias.map((c) => `<div class="op-row static"><span><strong>${esc(c.nombre)}</strong><small>${esc(c.segmento)} · ${esc(c.canal)}</small></span>${status(c.estado)}</div>`).join("")}</div>` : empty("Creá una lista para organizar un aviso o seguimiento.")}`, "op-section-gap");
    const draw = () => { const q = $("#opContactSearch").value.toLowerCase(); const type = $("#opContactType").value; const rows = contacts.filter((c) => (type === "todos" || c.tipo === type) && `${c.nombre} ${c.cedula || ""} ${c.telefono || ""} ${c.correo || ""}`.toLowerCase().includes(q)); $("#opContactsBody").innerHTML = rows.map((c) => `<tr><td><strong>${esc(c.nombre)}</strong>${c.no_contactar ? '<small class="op-block op-danger">No contactar</small>' : ""}</td><td>${esc(c.tipo)}</td><td>${esc(c.telefono || "—")}</td><td>${esc(c.correo || "—")}</td><td>${esc([c.ciudad, c.barrio].filter(Boolean).join(", ") || "—")}</td></tr>`).join("") || '<tr><td colspan="5" class="empty">Sin coincidencias.</td></tr>'; };
    $("#opDatabase").insertAdjacentHTML("afterbegin", mobileOpsNav("basedatos"));
    $("#opContactSearch").oninput = draw; $("#opContactType").onchange = draw; draw();
  }
  function openCampaign() {
    modal("Crear lista de comunicación", `<form id="opCampaignForm" class="op-form"><label class="op-wide">Nombre<input required name="nombre" placeholder="Ej. Actualización de datos"></label><label>Segmento<select name="segmento"><option>Todos los socios activos</option><option>Socios con cuotas pendientes</option><option>Pre-registros sin completar</option><option>Lista seleccionada</option></select></label><label>Canal<select name="canal"><option>WhatsApp Web</option><option>Correo electrónico</option><option>Llamada</option></select></label><label class="op-wide">Mensaje<textarea required name="mensaje" rows="5" placeholder="Escribí la plantilla de comunicación"></textarea></label><p class="op-help op-wide">Esta lista organiza el trabajo. Cada contacto debe confirmarse individualmente; el sistema nunca enviará mensajes masivos por sí solo.</p>${formActions("Guardar lista")}</form>`);
    bindFormCancel();
    $("#opCampaignForm").onsubmit = async (e) => { e.preventDefault(); const v = Object.fromEntries(new FormData(e.target)); try { await persist("campanias", Object.assign(v, { id: uuid(), estado: "planificada", creado_por: currentUser(), created_at: now() })); closeModal(); renderDatabase(); toast("Campaña guardada"); } catch (err) { toast(friendlyError(err, "No se pudo guardar la campaña")); } };
  }

  function renderReports() {
    syncCoreData();
    const movements = state.aportes.filter((m) => m.estado !== "anulada" && (reportPeriod === "todos" || m.periodo === reportPeriod));
    const taskInPeriod = (t) => reportPeriod === "todos" || String(t.vencimiento || t.created_at || "").slice(0, 7) === reportPeriod;
    const pendingTasks = state.tareas.filter((t) => t.estado !== "completada" && taskInPeriod(t)).length;
    const pendingDocs = state.documentos.filter((d) => ["faltante", "observado"].includes(d.estado)).length;
    const totals = movements.reduce((a, m) => { a.aporte += Number(m.aporte) || 0; a.solidaridad += Number(m.solidaridad) || 0; a.otros += Number(m.otros) || 0; return a; }, { aporte: 0, solidaridad: 0, otros: 0 });
    const periods = Array.from(new Set([today().slice(0, 7), ...state.aportes.map((m) => m.periodo).filter(Boolean)])).sort().reverse();
    const options = `<option value="todos"${reportPeriod === "todos" ? " selected" : ""}>Todos los periodos</option>${periods.map((p) => `<option value="${esc(p)}"${p === reportPeriod ? " selected" : ""}>${esc(periodLabel(p))}</option>`).join("")}`;
    $("#opReports").innerHTML = mobileOpsNav("reportes") + `<div class="op-report-toolbar"><label>Periodo del reporte<select class="field" id="opReportPeriod">${options}</select></label><div class="action-row"><button class="btn btn-secondary" id="opReportXlsx">Descargar Excel</button><button class="btn btn-primary" id="opReportPdf">Generar reporte PDF</button></div></div><div class="op-kpis op-kpis-four"><div class="card op-kpi"><span>Socios activos</span><strong>${socios.length}</strong></div><div class="card op-kpi"><span>Solicitudes abiertas</span><strong>${solicitudes.filter((s) => ["pendiente", "observada", "observado"].includes(s.estado)).length}</strong></div><div class="card op-kpi"><span>Tareas pendientes</span><strong>${pendingTasks}</strong></div><div class="card op-kpi"><span>Documentos pendientes</span><strong>${pendingDocs}</strong></div></div>${card(`<div class="op-report-period">${reportPeriod === "todos" ? "Todos los periodos" : esc(periodLabel(reportPeriod))}</div><div class="op-report-grid"><div><span>Total aportado</span><strong>${fmtGs(totals.aporte)}</strong><small>Certificados de aportación del periodo</small></div><div><span>Fondo de solidaridad</span><strong>${fmtGs(totals.solidaridad)}</strong><small>Movimientos vigentes del periodo</small></div><div><span>Otros conceptos</span><strong>${fmtGs(totals.otros)}</strong><small>Importes adicionales registrados</small></div><div><span>Movimientos</span><strong>${movements.length}</strong><small>Pagos incluidos en el filtro</small></div></div>`)}`;
    $("#opReportPeriod").onchange = (e) => { reportPeriod = e.target.value; renderReports(); };
    $("#opReportPdf").onclick = () => printOperationalReport(movements, totals, pendingTasks, pendingDocs);
    $("#opReportXlsx").onclick = () => exportOperationalReport(movements);
  }

  function periodLabel(period) {
    if (!/^\d{4}-\d{2}$/.test(String(period))) return period || "—";
    const [year, month] = period.split("-");
    return new Intl.DateTimeFormat("es-PY", { month: "long", year: "numeric" }).format(new Date(Number(year), Number(month) - 1, 1));
  }
  function exportOperationalReport(movements) {
    const rows = movements.map((m) => { const socio = findMember(m.socio_id); return { Periodo: m.periodo, Fecha: m.fecha_pago, Recibo: m.recibo_numero, "N.º de socio": socio && socio.numero_socio || "", Socio: memberName(socio), Cédula: socio && socio.cedula || "", Aporte: Number(m.aporte) || 0, Solidaridad: Number(m.solidaridad) || 0, "Otros conceptos": Number(m.otros) || 0, Total: (Number(m.aporte) || 0) + (Number(m.solidaridad) || 0) + (Number(m.otros) || 0), "Forma de pago": m.forma_pago, Estado: m.estado } });
    if (!rows.length) return toast("No hay movimientos en el periodo seleccionado.");
    exportWorkbook(rows, `reporte-cimientos-${reportPeriod}-${today()}.xlsx`, "Reporte"); toast("Reporte Excel generado");
  }
  function printOperationalReport(movements, totals, pendingTasks, pendingDocs) {
    const label = reportPeriod === "todos" ? "Todos los periodos" : periodLabel(reportPeriod);
    const rows = movements.length ? movements.map((m) => { const socio = findMember(m.socio_id); const total = (+m.aporte || 0) + (+m.solidaridad || 0) + (+m.otros || 0); return `<tr><td>${fmtDate(m.fecha_pago)}</td><td>${esc(m.recibo_numero)}</td><td>${esc(memberName(socio))}</td><td>${fmtGs(m.aporte)}</td><td>${fmtGs(m.solidaridad)}</td><td><strong>${fmtGs(total)}</strong></td></tr>`; }).join("") : '<tr><td colspan="6">No hay movimientos en este periodo.</td></tr>';
    institutionalPrint("Reporte operativo", `<div class="receipt-intro"><div><h1>Reporte operativo y de Tesorería</h1><p>Periodo: ${esc(label)}</p></div><span class="receipt-number">${movements.length} movimiento(s)</span></div><div class="receipt-grid"><div class="receipt-item"><small>Total aportado</small><strong>${fmtGs(totals.aporte)}</strong></div><div class="receipt-item"><small>Fondo de solidaridad</small><strong>${fmtGs(totals.solidaridad)}</strong></div><div class="receipt-item"><small>Tareas pendientes</small><strong>${pendingTasks}</strong></div><div class="receipt-item"><small>Documentos pendientes</small><strong>${pendingDocs}</strong></div></div><h2 style="font-size:14px;margin-top:24px">Detalle de movimientos</h2><table><thead><tr><th>Fecha</th><th>Recibo</th><th>Socio</th><th>Aporte</th><th>Solidaridad</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table>`, `REP-${reportPeriod}-${today()}`);
  }

  function filteredMembers() {
    syncCoreData();
    const q = ($("#memberSearch") && $("#memberSearch").value || "").toLowerCase();
    const active = $("#memberTypeFilter .active"); const type = active ? active.dataset.memberFilter : "todos";
    return socios.filter((m) => (type === "todos" || (m.tipo_socio || "ordinario") === type) && `${memberName(m)} ${m.cedula || ""} ${m.numero_socio || ""}`.toLowerCase().includes(q));
  }
  function exportWorkbook(rows, filename, sheetName) {
    if (!window.XLSX) return toast("No se pudo cargar el exportador de Excel.");
    const wb = XLSX.utils.book_new(); const ws = XLSX.utils.json_to_sheet(rows); ws["!cols"] = Object.keys(rows[0] || { Dato: "" }).map((k) => ({ wch: Math.min(34, Math.max(12, k.length + 4)) })); XLSX.utils.book_append_sheet(wb, ws, sheetName); XLSX.writeFile(wb, filename, { compression: true });
  }
  function exportMembers() {
    const rows = filteredMembers().map((m) => ({ "N.º de socio": m.numero_socio || "", "Apellidos y nombres": memberName(m), "Cédula": m.cedula || "", "Tipo de socio": (m.tipo_socio || "ordinario") === "fundador" ? "Fundador" : "Ordinario", "Fecha de ingreso": String(m.fecha_revision || m.created_at || "").slice(0, 10), "Estado": "Activo", "Celular": m.celular_whatsapp || m.celular || "", "Correo": m.correo_electronico || "", "Ciudad": m.ciudad || "", "Barrio": m.barrio || "" }));
    if (!rows.length) return toast("No hay socios para exportar."); exportWorkbook(rows, `padron-socios-${today()}.xlsx`, "Padrón"); toast("Excel generado");
  }
  function exportContacts() {
    const rows = allContacts().map((c) => ({ Nombre: c.nombre, Cédula: c.cedula || "", Teléfono: c.telefono || "", Correo: c.correo || "", Tipo: c.tipo, Ciudad: c.ciudad || "", Barrio: c.barrio || "", "No contactar": c.no_contactar ? "Sí" : "No" }));
    if (!rows.length) return toast("No hay contactos para exportar."); exportWorkbook(rows, `base-contactos-${today()}.xlsx`, "Contactos"); toast("Excel generado");
  }
  function printMemberRegistry() {
    const rows = filteredMembers(); if (!rows.length) return toast("No hay socios para imprimir.");
    const active = $("#memberTypeFilter .active"); const filter = active ? active.textContent.trim() : "Todos";
    institutionalPrint("Padrón de socios", `<h1>Padrón institucional de socios</h1><p>Filtro aplicado: ${esc(filter)} · Total incluido: <strong>${rows.length}</strong></p><table><thead><tr><th>N.º</th><th>Apellidos y nombres</th><th>Cédula</th><th>Tipo</th><th>Ingreso</th><th>Estado</th></tr></thead><tbody>${rows.map((m) => `<tr><td><strong>${esc(m.numero_socio || "s/n")}</strong></td><td>${esc(memberName(m))}</td><td>${esc(m.cedula || "—")}</td><td>${(m.tipo_socio || "ordinario") === "fundador" ? "Fundador" : "Ordinario"}</td><td>${fmtDate(m.fecha_revision || m.created_at)}</td><td>Activo</td></tr>`).join("")}</tbody></table><div class="signs"><div class="sign">Presidente — Consejo de Administración</div><div class="sign">Secretario — Consejo de Administración</div></div>`, `PADRÓN-${today()}`);
  }

  function bind() {
    $("#opModalClose").onclick = closeModal; $("#opModalBack").onclick = (e) => { if (e.target === $("#opModalBack")) closeModal(); };
    $("#opNewTask").onclick = () => openTask(); $("#opNewDocument").onclick = openDocument; $("#opNewResolution").onclick = openResolution; $("#opNewContribution").onclick = openContribution; $("#opNewCampaign").onclick = openCampaign;
    $("#opExportContacts").onclick = exportContacts; $("#exportMembersXlsx").onclick = exportMembers; $("#printMembers").onclick = printMemberRegistry;
    document.addEventListener("click", (e) => { const b = e.target.closest("[data-mobile-go]"); if (!b) return; const target = document.querySelector(`.sidebar [data-go="${b.dataset.mobileGo}"]`); if (target) target.click(); });
    $$('[data-go]').forEach((b) => b.addEventListener("click", () => { const view = b.dataset.go; if (view === "tareas") renderTasks(); if (view === "documentos") renderDocuments(); if (view === "resoluciones") renderResolutions(); if (view === "aportes") renderContributions(); if (view === "basedatos") renderDatabase(); if (view === "reportes") renderReports(); }));
  }
  function decorateOperationalIcons() {
    const paths = {
      tareas: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
      documentos: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h6"/>',
      resoluciones: '<path d="M6 3h12v18H6z"/><path d="M9 7h6M9 11h6M9 15h4"/>',
      aportes: '<circle cx="12" cy="12" r="9"/><path d="M15 8.5c-.6-.7-1.6-1-3-1-1.7 0-3 .8-3 2s1 1.8 3 2.2 3 1 3 2.3-1.3 2.5-3 2.5c-1.4 0-2.5-.4-3.2-1.2M12 5.5v13"/>',
      basedatos: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
      reportes: '<path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/>'
    };
    Object.entries(paths).forEach(([name, path]) => { const icon = document.querySelector(`[data-go="${name}"] .ico`); if (icon) icon.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`; });
  }
  async function init() {
    await loadBaseData(); await loadOperations(); bind(); decorateOperationalIcons(); renderTasks(); renderDocuments(); renderResolutions(); renderContributions(); renderDatabase(); renderReports();
  }
  init().catch((err) => { console.error("Cimientos operaciones:", err); toast("No se pudieron iniciar los módulos operativos."); });
})();
