(function () {
  "use strict";
  const core = window.cimientosData;
  const client = window.cimientosSupabase;
  const esc = value => String(value ?? "").replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const label = value => ({activo:"Activo",suspendido:"Suspendido",renuncia_en_tramite:"Renuncia en trámite",baja_voluntaria:"Baja voluntaria",excluido:"Excluido",expulsado:"Expulsado",fallecido:"Fallecido",iniciado:"Iniciado",notificado:"Notificado · plazo de 30 días",sumario_abierto:"Sumario abierto",sancion_resuelta:"Sanción resuelta",reconsideracion:"Reconsideración",apelacion:"Apelación",firme:"Decisión firme",regularizado:"Cerrado sin baja",cerrado:"Cerrado",renuncia:"Renuncia voluntaria",exclusion:"Exclusión",expulsion:"Expulsión",fallecimiento:"Fallecimiento"}[value] || value || "—");
  const today = () => new Intl.DateTimeFormat('en-CA',{timeZone:'America/Asuncion',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const money = n => `${Number(n || 0).toLocaleString('es-PY')} Gs.`;
  const field = (name,title,value="",type="text",required=false) => `<label class="formfield">${title}<input name="${name}" type="${type}" value="${esc(value)}" ${required?'required':''}></label>`;
  const buttons = title => `<p role="status" id="socStatus"></p><div style="display:flex;justify-content:flex-end;gap:10px;margin-top:18px"><button type="button" class="btn btn-secondary" id="socCancel">Volver</button><button class="btn btn-primary" type="submit">${title}</button></div>`;
  const docOptions = docs => '<option value="">Seleccioná un documento registrado</option>'+docs.map(d=>`<option value="${esc(d.id)}">${esc(d.tipo)} · ${esc(d.nombre_archivo || d.id)}</option>`).join('');
  async function query(table,member) { const {data,error}=await client.from(table).select('*').eq('socio_id',member.id); if(error)throw error; return data || []; }
  function bindForm(member,rpc,base) {
    document.querySelector('#socCancel').onclick=()=>open(member.id);
    document.querySelector('#socForm').onsubmit=async e=>{
      e.preventDefault(); const payload={...base,...Object.fromEntries(new FormData(e.target))};
      ['intereses_pendientes','retornos_pendientes','otras_acreditaciones','obligaciones_pendientes','perdidas_imputables'].forEach(k=>{if(k in payload)payload[k]=Number(payload[k].replace(/\D/g,'')) || 0;});
      if(payload.etapa==='firme' && !confirm('¿Confirmás que la resolución está firme y corresponde registrar la pérdida de calidad de socio? La matrícula se conservará.'))return;
      e.submitter.disabled=true;
      try {const {error}=await client.rpc(rpc,{p_datos:payload});if(error)throw error;await core.refresh();await open(member.id);}
      catch(err){document.querySelector('#socStatus').textContent=err.message;e.submitter.disabled=false;}
    };
  }
  async function open(id) {
    const member=core.solicitudes().find(s=>String(s.id)===String(id));if(!member)return;
    core.modal('Estado societario', '<p>Cargando historial…</p>');
    if(!client){core.modal('Estado societario','<p>Esta función requiere conexión a la base institucional. No se registran bajas solo en este navegador.</p>');return;}
    try {
      const [rows,docs,resolutions]=await Promise.all([query('tramites_baja',member),query('documentos_socios',member),query('resoluciones_consejo',member)]);
      const allowed=['superadministrador','consejo','secretaria'].includes(core.role());
      const active=rows.find(r=>!['regularizado','cerrado'].includes(r.etapa));
      const docRows=docs.filter(d=>d.storage_path);
      core.modal('Estado societario', `<h3>${esc(member.apellidos_nombres)} · N.º ${esc(member.numero_socio)}</h3><p>${esc(label(member.estado_societario || 'activo'))} · Ingreso: ${esc(member.fecha_ingreso || 'Fecha histórica por confirmar')}</p><p>La matrícula es permanente: una baja no borra la ficha ni permite reutilizar su número. Un reingreso se tramita como una nueva admisión.</p>${rows.map(r=>`<div class="item"><div><strong>${esc(label(r.tipo_baja))} — ${esc(label(r.etapa))}</strong><p>${esc(r.fecha_presentacion)} · ${esc(r.motivo)}</p>${r.plazo_hasta?`<p>Plazo de regularización hasta: ${esc(r.plazo_hasta)}</p>`:''}${r.fecha_efectiva?`<p>Baja efectiva: ${esc(r.fecha_efectiva)} · Liquidación: ${esc(r.estado_liquidacion)}</p>`:''}</div></div>`).join('') || '<p>No hay trámites de baja.</p>'}<div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:18px">${allowed && !active && ['activo','suspendido'].includes(member.estado_societario || 'activo')?'<button class="btn btn-secondary" id="socNew">Iniciar trámite de baja</button>':''}${allowed && active && active.etapa!=='firme'?'<button class="btn btn-primary" id="socContinue">Continuar trámite</button>':''}${active?.etapa==='firme' && ['superadministrador','consejo','tesoreria'].includes(core.role())?'<button class="btn btn-primary" id="socLiquidation">Liquidación de haberes</button>':''}</div>`);
      if(document.querySelector('#socNew'))document.querySelector('#socNew').onclick=()=>{
        core.modal('Iniciar trámite de baja',`<p>Registrá primero el escrito o respaldo en Documentos. Esto abre el trámite; no confirma automáticamente una baja.</p><form id="socForm"><div class="formgrid"><label class="formfield">Tipo<select name="tipo_baja">${['renuncia','exclusion','expulsion','fallecimiento'].map(x=>`<option value="${x}">${label(x)}</option>`).join('')}</select></label>${field('fecha_presentacion','Fecha de presentación',today(),'date',true)}<label class="formfield">Documento de respaldo<select name="documento_solicitud" required>${docOptions(docRows)}</select></label>${field('motivo','Motivo','','text',true)}</div>${buttons('Abrir trámite')}</form>`);bindForm(member,'fn_guardar_tramite_baja',{socio_id:member.id});
      };
      if(document.querySelector('#socContinue'))document.querySelector('#socContinue').onclick=()=>{
        let options=[];
        if(active.tipo_baja==='exclusion')options=active.etapa==='iniciado'?['notificado','regularizado']:['regularizado','firme'];
        else if(active.tipo_baja==='expulsion')options=active.etapa==='sumario_abierto'?['sancion_resuelta']:active.etapa==='sancion_resuelta'?['reconsideracion','apelacion','firme']:active.etapa==='reconsideracion'?['apelacion','firme']:['firme'];
        else options=active.tipo_baja==='renuncia'?['regularizado','firme']:['firme'];
        if(!['superadministrador','consejo'].includes(core.role()))options=options.filter(x=>x!=='firme');
        core.modal('Continuar trámite',`<p>${esc(label(active.tipo_baja))}. La base valida las etapas, el plazo y la resolución. La firmeza debe ser comprobada por el Consejo, no la decide el sistema.</p><form id="socForm"><div class="formgrid"><label class="formfield">Siguiente etapa<select name="etapa" required>${options.map(x=>`<option value="${x}">${label(x)}</option>`).join('')}</select></label>${field('fecha_notificacion','Fecha de notificación (exclusión)','','date')}<label class="formfield">Evidencia de notificación<select name="evidencia_notificacion">${docOptions(docRows)}</select></label><label class="formfield">Resolución emitida (decisión firme)<select name="resolucion_id"><option value="">Seleccioná una resolución</option>${resolutions.filter(r=>r.estado==='emitida').map(r=>`<option value="${esc(r.id)}">${esc(r.numero)} · ${esc(r.fecha)}</option>`).join('')}</select></label>${field('fecha_efectiva','Fecha efectiva (decisión firme)','','date')}</div><label class="formfield">Actuación, resultado y fundamento<textarea name="observaciones" required minlength="5" rows="3"></textarea></label>${buttons('Guardar actuación')}</form>`);bindForm(member,'fn_guardar_tramite_baja',{id:active.id,socio_id:member.id});
      };
      if(document.querySelector('#socLiquidation'))document.querySelector('#socLiquidation').onclick=()=>liquidation(member,active,docRows);
    }catch(err){core.modal('Estado societario',`<p role="alert">${esc(err.message)}</p><p>No se modificó el socio.</p>`);}
  }
  async function liquidation(member,tramite,docs) {
    try {
      const rows=await query('liquidaciones_socios',member);const l=rows.find(x=>x.tramite_id===tramite.id)||{};
      const labels={intereses_pendientes:'Intereses pendientes',retornos_pendientes:'Retornos pendientes',otras_acreditaciones:'Otras acreditaciones',obligaciones_pendientes:'Obligaciones pendientes',perdidas_imputables:'Pérdidas imputables'};
      const editable=!l.estado || l.estado==='pendiente';
      const states=l.estado==='aprobada'?['en_reintegro','cerrada']:l.estado==='en_reintegro'?['cerrada']:['pendiente',...(['superadministrador','consejo'].includes(core.role())?['aprobada']:[])];
      core.modal('Liquidación de haberes',`<p>Requiere revisión contable. El capital se toma de los registros de aportación; no incluye solidaridad. Verificá que los pagos históricos estén completos antes de aprobar.</p>${l.id?`<p>Capital registrado: <strong>${money(l.capital_integrado)}</strong> · Saldo calculado: <strong>${money(l.saldo_final)}</strong></p>`:'<p>Al guardar se calculará y conservará la fotografía del capital registrado.</p>'}<form id="socForm"><fieldset ${editable?'':'disabled'} style="border:0;padding:0"><div class="formgrid">${Object.entries(labels).map(([k,v])=>field(k,`${v} (Gs.)`,Number(l[k]||0).toLocaleString('es-PY'))).join('')}</div></fieldset><div class="formgrid">${field('forma_reintegro','Forma de reintegro',l.forma_reintegro||'','text',true)}${field('cantidad_cuotas','Cantidad de cuotas',l.cantidad_cuotas||1,'number',true)}<label class="formfield">Etapa<select name="estado">${states.map(x=>`<option>${x}</option>`).join('')}</select></label>${field('fecha_cierre','Fecha de cierre (solo al cerrar)','','date')}<label class="formfield">Comprobante de reintegro / cancelación<select name="comprobante_reintegro">${docOptions(docs)}</select></label></div><label class="formfield">Fundamento y observaciones<textarea name="observaciones" required minlength="5" rows="3">${esc(l.observaciones||'')}</textarea></label>${buttons('Guardar liquidación')}</form>`);
      for(const k of Object.keys(labels))document.querySelector(`[name="${k}"]`).oninput=e=>{const n=e.target.value.replace(/\D/g,'').slice(0,14);e.target.value=n?Number(n).toLocaleString('es-PY'):'';};
      bindForm(member,'fn_guardar_liquidacion',{tramite_id:tramite.id});
    }catch(err){core.modal('Liquidación',`<p role="alert">${esc(err.message)}</p>`);}
  }
  async function report() {
    core.modal('Histórico societario',`<p>Consultá el padrón a una fecha de corte. Las fechas desconocidas se informan por separado; no se reemplazan por la fecha de carga.</p><form id="historyForm">${field('fecha','Fecha de corte',today(),'date',true)}<label class="formfield">Contenido<select name="tipo"><option value="padron">Padrón histórico</option><option value="vigentes">Con calidad de socio vigente al corte</option><option value="bajas">Pérdidas de calidad de socio</option></select></label><button class="btn btn-primary" type="submit">Consultar</button><p role="status" id="historyStatus"></p></form><div id="historyResults"></div>`);
    document.querySelector('#historyForm').onsubmit=async e=>{
      e.preventDefault();const v=Object.fromEntries(new FormData(e.target));e.submitter.disabled=true;
      try {
        if(!client)throw Error('Conectá la base institucional para consultar el histórico.');
        const {data,error}=await client.rpc('fn_reporte_societario',{p_fecha:v.fecha});if(error)throw error;
        const rows=(data.socios||[]).filter(s=>v.tipo==='vigentes'?s.calidad_vigente_al_corte:v.tipo==='bajas'?s.fecha_baja && s.fecha_baja<=v.fecha:true);
        const note=`Corte: ${v.fecha} · ${rows.length} registros · ${data.sin_fecha_confirmada} sin fecha de ingreso confirmada (excluidos del corte). La vigencia de la calidad de socio no certifica habilitación para votar.`;
        document.querySelector('#historyResults').innerHTML=`<p>${esc(note)}</p><button class="btn btn-secondary" id="historyCSV">Descargar CSV</button> <button class="btn btn-primary" id="historyPDF">Generar PDF</button>`;
        const columns=['Número','Nombre','Cédula','Ingreso','Baja','Causa de baja'];
        const values=rows.map(s=>[s.numero_socio,s.nombre,s.cedula,s.fecha_ingreso,s.fecha_baja,s.causa_baja]);
        document.querySelector('#historyCSV').onclick=()=>{
          const cell=x=>'"'+String(x??'').replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"';
          const blob=new Blob(['\ufeff'+[columns,...values].map(r=>r.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`societario-${v.tipo}-${v.fecha}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
        };
        document.querySelector('#historyPDF').onclick=()=>window.cimientosOperations.print('Reporte societario',`<h1>Histórico societario</h1><p>${esc(note)}</p><table><thead><tr>${columns.map(c=>`<th>${c}</th>`).join('')}</tr></thead><tbody>${values.map(r=>`<tr>${r.map(c=>`<td>${esc(c||'—')}</td>`).join('')}</tr>`).join('')}</tbody></table>`,`SOC-${v.fecha}`);
        document.querySelector('#historyStatus').textContent='Consulta actualizada desde la base de datos.';
      }catch(err){document.querySelector('#historyResults').innerHTML='';document.querySelector('#historyStatus').textContent=err.message;}
      finally{e.submitter.disabled=false;}
    };
  }
  async function bulk(kind,table) {
    core.modal('Eliminar seleccionados','<p>Cargando registros…</p>');
    try {
      if(!client)throw Error('La eliminación múltiple de esta sección requiere conexión institucional.');
      const {data,error}=await core.readAll(table);if(error)throw error;
      const rows=data.filter(r=>kind!=='solicitudes'||(!r.numero_socio&&r.estado!=='aprobado'));
      core.modal('Eliminar seleccionados',`<p>Elegí los registros que ya no necesitás. Se conservará el motivo en la auditoría. No se eliminan socios ni pagos.</p><form id="genericBulk"><label><input type="checkbox" id="genericAll"> Seleccionar todos (hasta 500)</label><div style="max-height:340px;overflow:auto;margin:15px 0">${rows.slice(0,500).map(r=>`<label class="item"><input type="checkbox" name="ids" value="${esc(r.id)}">${esc(r.apellidos_nombres||r.titulo||r.nombre||r.id)} · ${esc(r.estado)}</label>`).join('')||'<p>No hay registros para eliminar.</p>'}</div>${field('motivo','Motivo','','text',true)}<p role="status" id="genericStatus"></p><button class="btn btn-primary" type="submit" ${rows.length?'':'disabled'}>Eliminar seleccionados</button></form>`);
      document.querySelector('#genericAll').onchange=e=>document.querySelectorAll('#genericBulk [name="ids"]').forEach(c=>c.checked=e.target.checked);
      document.querySelector('#genericBulk').onsubmit=async e=>{
        e.preventDefault();const values=new FormData(e.target);const ids=values.getAll('ids');const reason=values.get('motivo').trim();
        if(!ids.length||reason.length<5){document.querySelector('#genericStatus').textContent='Seleccioná registros e indicá un motivo de al menos 5 caracteres.';return;}
        if(!confirm(`¿Eliminar definitivamente ${ids.length} registro(s)?`))return;e.submitter.disabled=true;
        try{const result=await client.rpc('fn_eliminar_lote',{p_tipo:kind,p_ids:ids,p_motivo:reason});if(result.error)throw result.error;await core.refresh();await window.cimientosOperations.refresh();core.closeModal();}
        catch(err){document.querySelector('#genericStatus').textContent=err.message;e.submitter.disabled=false;}
      };
    }catch(err){core.modal('Eliminar seleccionados',`<p role="alert">${esc(err.message)}</p>`);}
  }
  for(const [view,kind,table] of [['solicitudes','solicitudes','solicitudes_socios'],['tareas','tareas','tareas_operativas'],['basedatos','campanias','campanias']]) {
    const head=document.querySelector(`#view-${view} .pagehead`);if(!head)continue;
    const button=document.createElement('button');button.className='btn btn-secondary';button.textContent=kind==='campanias'?'Eliminar campañas…':'Eliminar…';button.onclick=()=>bulk(kind,table);head.append(button);
  }
  const reportsHead=document.querySelector('#view-reportes .pagehead');
  if(reportsHead){const button=document.createElement('button');button.className='btn btn-secondary';button.textContent='Histórico societario';button.onclick=report;reportsHead.append(button);}
  document.addEventListener('click',e=>{const b=e.target.closest('[data-member-status]');if(b)open(b.dataset.memberStatus);});
})();
