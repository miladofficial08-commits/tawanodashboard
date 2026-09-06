let plannerDay = PlannerTime.dateKey();
let plannerMode = 'day';
let plannerStatus = 'open';
let workSaving = false;
let workRevision = 0;
let detailCallId = null;
let detailWorkVersion = null;

// Strukturierte Rueckrufzeit: aus der Nachbearbeitung des Telefonassistenten
// (call.callback) und aus einem Rueckrufauftrag, den er waehrend des Gespraechs
// selbst angelegt hat (callback_requests.callback_at).
function callbackFieldsFor(call) {
  const fields = Object.assign({}, call.callback && typeof call.callback === 'object' ? call.callback : null);
  const request = (callbackRequests || []).find(row => row && String(row.call_id || '') === callKey(call));
  if (request) {
    if (!fields.at && request.callback_at) fields.at = request.callback_at;
    if (!fields.end && request.callback_end) fields.end = request.callback_end;
  }
  return fields;
}
// Reihenfolge: eigene Eingabe schlaegt strukturierte Angabe, diese schlaegt Freitext.
function scheduleFor(call) {
  return memoOnCall(call, '_schedule', workStamp(call), () => computeSchedule(call));
}
function computeSchedule(call) {
  const work = call.work || {};
  if (work.schedule_manual) {
    const at = work.scheduled_at;
    return {day:at ? PlannerTime.dateKey(at) : null,time:at ? PlannerTime.clock(at) : null,iso:at || null,label:at?'Von dir geplant':'Zeit noch klären'};
  }
  return PlannerTime.fromStructured(callbackFieldsFor(call),call.createdAt)
    || PlannerTime.parse(detailSummarySource(call),call.createdAt);
}
function plannerEntries() {
  return calls.map((call,index)=>({call,index,info:classifyCall(call),schedule:scheduleFor(call)}))
    .filter(e=>e.info.key!=='live' && (plannerStatus==='done' ? e.info.key==='done' : e.info.key!=='done'))
    .sort((a,b)=>(a.schedule.iso || a.schedule.day || '9999').localeCompare(b.schedule.iso || b.schedule.day || '9999') || callTimeMs(a.call)-callTimeMs(b.call));
}
function changePlanner(mode,day) {
  if (mode) plannerMode=mode;
  if (day) plannerDay=day;
  renderPlanner();
}
function stepPlanner(delta) { plannerDay=PlannerTime.addDays(plannerDay,delta*(plannerMode==='week'?7:1)); renderPlanner(); }
function dayLabel(day) { return new Date(day+'T12:00:00Z').toLocaleDateString('de-DE',{weekday:'long',day:'numeric',month:'long',timeZone:'Europe/Berlin'}); }
function plannerCard(entry,compact=false) {
  const {call,index,schedule,info}=entry;
  const past = schedule.iso && Date.parse(schedule.iso)<Date.now() && info.key!=='done';
  const time = schedule.time ? (schedule.end ? schedule.time+'–'+schedule.end : schedule.time)+' Uhr' : 'Uhrzeit offen';
  return '<article class="planner-card '+(past?'is-overdue':'')+'" data-call="'+escHtml(callKey(call))+'">'
    + '<button class="planner-open" onclick="openDetail('+index+')"><span class="planner-time">'+escHtml(time)+(past?'<small>Rückruf fällig</small>':'')+'</span>'
    + '<span class="planner-person"><strong>'+escHtml(customerLabel(call))+'</strong><span>'+escHtml(callBrief(call).title)+'</span>'
    + (call.work?.notes?'<small class="note-preview">Notiz: '+escHtml(shortFact(call.work.notes,90))+'</small>':'')+'</span></button>'
    + (!compact?'<div class="planner-actions"><button class="btn-mini primary" onclick="contactCustomer(\'call\','+index+')" '+(!customerPhone(call)?'disabled':'')+'>Anrufen</button><button class="btn-mini" onclick="openDetail('+index+')">Details & Notizen</button><button class="btn-mini" onclick="'+(info.key==='done'?'reopenTask':'markTaskDone')+'('+index+')">'+(info.key==='done'?'Wieder öffnen':'Erledigt')+'</button></div>':'')+'</article>';
}
function renderPlanner() {
  const root=document.getElementById('planner-body'); if(!root)return;
  const entries=plannerEntries();
  const today=PlannerTime.dateKey();
  const week=PlannerTime.monday(plannerDay);
  const days=plannerMode==='week'?Array.from({length:7},(_,i)=>PlannerTime.addDays(week,i)):[plannerDay];
  document.getElementById('planner-date').value=plannerDay;
  document.getElementById('planner-title').textContent=plannerMode==='week'?dayLabel(week)+' – '+dayLabel(days[6]):dayLabel(plannerDay);
  document.getElementById('planner-clock').textContent='Jetzt '+PlannerTime.clock()+' Uhr · '+dayLabel(today);
  document.querySelectorAll('[data-planner-mode]').forEach(b=>b.classList.toggle('active',b.dataset.plannerMode===plannerMode));
  document.querySelectorAll('[data-planner-status]').forEach(b=>b.classList.toggle('active',b.dataset.plannerStatus===plannerStatus));
  const open=calls.filter(c=>!['done','live'].includes(classifyCall(c).key));
  document.getElementById('tasks-nav-count').textContent=open.length||'';
  document.getElementById('planner-open-count').textContent=open.length;
  document.getElementById('planner-today-count').textContent=open.filter(c=>scheduleFor(c).day===today).length;
  document.getElementById('planner-unscheduled-count').textContent=open.filter(c=>!scheduleFor(c).iso).length;
  const filterNote=document.getElementById('planner-filter-note');
  if(filterNote){
    const hiddenOpen=plannerStatus==='done'?open.filter(c=>days.includes(scheduleFor(c).day)).length:0;
    filterNote.textContent=hiddenOpen?'Ansicht steht auf „Erledigt“ · '+hiddenOpen+' offene Rückrufe sind ausgeblendet.':'';
    filterNote.classList.toggle('hidden',!hiddenOpen);
  }
  root.className=plannerMode==='week'?'planner-week':'planner-day';
  root.innerHTML=days.map(day=>{
    const group=entries.filter(e=>e.schedule.day===day);
    let inserted=false;
    let cards=group.map(e=>{
      let marker='';
      if(plannerMode==='day' && day===today && !inserted && e.schedule.time && e.schedule.time>=PlannerTime.clock()) {inserted=true;marker='<div class="now-line">Jetzt · '+PlannerTime.clock()+'</div>';}
      return marker+plannerCard(e,plannerMode==='week');
    }).join('');
    if(plannerMode==='day' && day===today && !inserted)cards+='<div class="now-line">Jetzt · '+PlannerTime.clock()+'</div>';
    return '<section class="planner-column '+(day===today?'is-today':'')+'"><h3>'+escHtml(new Date(day+'T12:00Z').toLocaleDateString('de-DE',{weekday:'short',day:'2-digit',month:'2-digit',timeZone:'Europe/Berlin'}))+'<span>'+group.length+'</span></h3>'+cards+(!group.length?'<p class="planner-empty">'+(plannerStatus==='done'?'Keine erledigten Rückrufe an diesem Tag.':'Keine Rückrufe geplant.')+'</p>':'')+'</section>';
  }).join('');
  const overdue=entries.filter(e=>e.schedule.day && e.schedule.day<days[0]);
  const unclear=entries.filter(e=>!e.schedule.day);
  const later=entries.filter(e=>e.schedule.day>days[days.length-1]);
  document.getElementById('planner-extra').innerHTML=[
    [plannerStatus==='done'?'Früher erledigt':'Frühere offene Rückrufe',overdue],[plannerStatus==='done'?'Abgeschlossen ohne Rückruftermin':'Zeit noch klären',unclear],['Später geplant',later]
  ].filter(([,rows])=>rows.length).map(([title,rows])=>'<details class="planner-group" '+(title==='Zeit noch klären'||title==='Frühere offene Rückrufe'?'open':'')+'><summary>'+title+' <span>'+rows.length+'</span></summary>'
    +rows.slice(0,GROUP_LIMIT).map(e=>(e.schedule.day?'<p class="group-date">'+escHtml(dayLabel(e.schedule.day))+'</p>':'')+plannerCard(e)).join('')
    +(rows.length>GROUP_LIMIT?'<p class="planner-empty">… und '+(rows.length-GROUP_LIMIT)+' weitere. Über den Zeitraum oben eingrenzen.</p>':'')+'</details>').join('');
}
function renderTasks() { renderPlanner(); }
const GROUP_LIMIT = 40; // lange Listen bremsen die Ansicht; Rest ueber den Zeitraum
async function saveWork(index,patch,expectedVersion,options) {
  if(workSaving)throw new Error('Bitte warte, bis die Änderung gespeichert ist.');
  const call=calls[index]; if(!call)throw new Error('Gespräch nicht gefunden.');
  workSaving=true; workRevision++;
  try {
    let work;
    if(previewMode)work={...(call.work||{}),...patch,...('scheduled_at' in patch?{schedule_manual:true}: {}),...('state' in patch?{state_manual:true}:{})};
    else {
      const result=await fetchApi('/api/call-workspace',{method:'POST',headers:authHeaders(),body:JSON.stringify({call_id:callKey(call),expected_updated_at:expectedVersion || call.work?.updated_at,...patch})});
      if(!result.res.ok || !result.data.ok)throw new Error(result.data.message || 'Speichern fehlgeschlagen.');
      work=result.data.work;
    }
    call.work=work;
    if(work.state==='deleted')calls=calls.filter(c=>c!==call);
    if(options && options.defer)return work;
    render(); setStatus('ok',previewMode?'Vorschau geändert':'Gespeichert');
    return work;
  } finally {workSaving=false;workRevision++;}
}
async function reopenTask(index) {
  try {await saveWork(index,{state:'open'});toast('Wieder geöffnet');}catch(e){alert(e.message);}
}
function workEditorHtml(call) {
  const s=scheduleFor(call);
  return '<section class="work-editor" id="work-editor"><h3>Rückruf bearbeiten</h3><p>Rückrufzeit in Deutschland · Europe/Berlin</p>'
    + '<div class="editor-dates"><label>Tag<input id="work-day" type="date" value="'+escHtml(s.day||'')+'"></label><label>Uhrzeit<input id="work-time" type="time" value="'+escHtml(s.time||'')+'"></label></div>'
    + '<p class="schedule-source">'+escHtml(s.label)+(s.end?' · Zeitfenster bis '+escHtml(s.end)+' Uhr':'')+'</p>'
    + '<label>Deine Notizen<textarea id="work-notes" maxlength="5000" rows="4" placeholder="Zum Beispiel: Nicht erreicht. Erneut morgen anrufen.">'+escHtml(call.work?.notes||'')+'</textarea></label>'
    + '<div class="planner-actions"><button class="btn-mini primary" onclick="saveWorkEditor()">Speichern</button><button class="btn-mini" onclick="clearWorkSchedule()">Zeit zurückstellen</button><button class="btn-mini" onclick="finishWorkEditor()">'+(classifyCall(call).key==='done'?'Wieder öffnen':'Als erledigt markieren')+'</button><button class="btn-mini danger" onclick="document.getElementById(\'work-delete-confirm\').classList.remove(\'hidden\')">Aus Dashboard löschen</button></div><div id="work-delete-confirm" class="delete-confirm hidden"><p>Eintrag und Notizen aus dem Dashboard löschen? Er wird nicht erneut importiert. Die Aufnahme beim Telefonanbieter bleibt bestehen.</p><button class="btn-mini danger" onclick="deleteWorkEditor()">Löschen bestätigen</button><button class="btn-mini" onclick="document.getElementById(\'work-delete-confirm\').classList.add(\'hidden\')">Abbrechen</button></div><p id="work-message" role="status"></p></section>';
}
function clearWorkSchedule(){document.getElementById('work-day').value='';document.getElementById('work-time').value='';}
async function saveWorkEditor(nextState) {
  const index=calls.findIndex(c=>callKey(c)===detailCallId);
  const call=calls[index]; if(!call)return;
  const msg=document.getElementById('work-message');
  const day=document.getElementById('work-day').value,time=document.getElementById('work-time').value;
  const patch={notes:document.getElementById('work-notes').value};
  const old=scheduleFor(call);
  if(day!==(old.day||'') || time!==(old.time||'')) {
    if((day&&!time)||(!day&&time)){msg.textContent='Bitte Tag und Uhrzeit zusammen eingeben oder beide leeren.';return;}
    const iso=day?PlannerTime.fromLocal(day,time):null;
    if(day&&!iso){msg.textContent='Diese Uhrzeit ist ungültig oder durch die Zeitumstellung mehrdeutig. Bitte eine andere wählen.';return;}
    patch.scheduled_at=iso;
  }
  if(nextState)patch.state=nextState;
  const buttons=document.querySelectorAll('#work-editor button'); buttons.forEach(b=>b.disabled=true);
  msg.textContent='Speichert…';
  try {
    await saveWork(index,patch,detailWorkVersion);
    detailWorkVersion=call.work?.updated_at;
    msg.textContent=previewMode?'In der Vorschau geändert.':'Gespeichert – auf allen Geräten verfügbar.';
    // Nach dem Planen direkt auf den geplanten Tag springen (und auf "Offen"),
    // sonst sucht der Handwerker seinen gerade gesetzten Rueckruf im falschen Filter.
    if('scheduled_at' in patch){
      if(patch.scheduled_at){
        plannerDay=PlannerTime.dateKey(patch.scheduled_at);
        plannerStatus='open';
        renderPlanner();
        toast('Rückruf geplant: '+dayLabel(plannerDay)+', '+PlannerTime.clock(patch.scheduled_at)+' Uhr');
      } else toast('Rückrufzeit zurückgestellt');
    }
    if(nextState==='done')toast('Erledigt · zu finden im Reiter „Erledigt“');
    if(nextState==='open')toast('Wieder geöffnet');
    if(nextState)closeDetail();
  }
  catch(e){msg.textContent=e.message;}
  finally{buttons.forEach(b=>b.disabled=false);}
}
function finishWorkEditor(){const c=calls.find(c=>callKey(c)===detailCallId); if(c)saveWorkEditor(classifyCall(c).key==='done'?'open':'done');}
async function deleteWorkEditor() {
  const index=calls.findIndex(c=>callKey(c)===detailCallId);
  try {await saveWork(index,{state:'deleted'},detailWorkVersion);closeDetail();toast('Aus dem Dashboard gelöscht');}catch(e){document.getElementById('work-message').textContent=e.message;}
}
setInterval(()=>{if(!document.hidden && currentTenant)renderPlanner();},30000);
