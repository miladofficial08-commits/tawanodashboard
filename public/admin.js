
let ADMIN = '';
function api(path, payload) {
  if (adminPreview) {
    if (path === '/api/admin/list-customers') return Promise.resolve({ok:true, customers:previewCustomers});
    return Promise.reject(new Error('Design-Vorschau: Änderungen werden nicht gespeichert. Melde dich an, um echte Kunden zu verwalten.'));
  }
  return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ admin_secret: ADMIN }, payload || {})) })
    .then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok || !d.ok) throw new Error(d.message || ('HTTP ' + r.status)); return d; });
}
function esc(v){ return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function fmt(iso){ if(!iso) return '-'; return new Date(iso).toLocaleString('de-DE',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}); }
function initials(name){ const p=String(name||'').trim().split(/\s+/); return ((p[0]||'')[0]||'?').toUpperCase()+((p[1]||'')[0]||'').toUpperCase(); }
function money(n){ return (Number(n)||0).toFixed(2).replace('.',',')+' €'; }

async function login() {
  const m=document.getElementById('login-msg'); m.className='msg'; m.textContent='';
  ADMIN=(document.getElementById('admin_secret').value||'').trim();
  if(!ADMIN){ m.className='msg err'; m.textContent='Bitte Passwort eingeben.'; return; }
  try {
    await loadCustomers();
    document.getElementById('login-card').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    document.getElementById('top-info').textContent='Eingeloggt'; document.getElementById('admin-logout').classList.remove('hidden');
  } catch(e){ ADMIN=''; m.className='msg err'; m.textContent='Login fehlgeschlagen: '+(e.message||e); }
}
function toggleCreate(){ document.getElementById('create-card').classList.toggle('hidden'); }

async function loadCustomers() {
  const data=await api('/api/admin/list-customers');
  const list=data.customers||[];
  const showHidden = document.getElementById('show-hidden-customers').checked;
  const visible = list.filter(c => showHidden || !isHiddenCustomer(c));
  const hiddenCount = list.filter(isHiddenCustomer).length;
  document.getElementById('cust-count').textContent=visible.length+' sichtbare Kunden'+(hiddenCount ? ' · '+hiddenCount+' ausgeblendet' : '');
  document.getElementById('customers').innerHTML = visible.map(renderCustomer).join('') || '<div class="card"><p class="sub" style="margin:0">Keine sichtbaren Kunden. Lege oben einen neuen Betrieb an.</p></div>';
  filterCustomers(document.getElementById('customer-search').value);
}
function isHiddenCustomer(customer) { return String(customer.name || '').replace(/\s/g,'').toLowerCase() === 'beautyworld'; }

function setAdminView(name) {
  document.getElementById('view-customers').classList.toggle('hidden', name !== 'customers');
  document.getElementById('view-numbers').classList.toggle('hidden', name !== 'numbers');
  document.getElementById('atab-customers').classList.toggle('active', name === 'customers');
  document.getElementById('atab-numbers').classList.toggle('active', name === 'numbers');
  if (name === 'numbers') loadNumbers();
}
async function loadNumbers() {
  const el = document.getElementById('numbers-list');
  el.innerHTML = '<p class="sub">Wird geladen...</p>';
  try {
    const d = await api('/api/admin/cost-numbers');
    const list = d.numbers || [];
    const tot = d.totals || {};
    document.getElementById('num-sub').textContent = 'Nur zugeordnete Kunden-Nummern. Basierend auf den letzten ' + (d.based_on_calls || 0) + ' Anrufen.';
    const banner = '<div class="cost" style="margin-bottom:16px">'
      + '<div class="total"><small>Gesamtkosten ALLER Nummern</small><b>' + money(tot.total) + '</b></div>'
      + '<div class="bd"><span>Anrufe: <b>' + (tot.calls || 0) + '</b></span><span>Twilio: <b>' + money(tot.twilio) + '</b></span><span>Retell: <b>' + money(tot.retell) + '</b></span><span>SMS: <b>' + money(tot.sms) + '</b></span></div></div>';
    el.innerHTML = banner + (list.map(renderNumber).join('') || '<div class="card"><p class="sub" style="margin:0">Keine Kunden-Nummern.</p></div>');
  } catch (e) { el.innerHTML = '<div class="card"><p class="msg err" style="margin:0">Fehler: ' + (e.message || e) + '</p></div>'; }
}
function renderNumber(n) {
  return '<div class="numcard">'
    + '<div class="nhead"><div><div class="num">' + esc(n.number) + '</div><div class="who">' + esc((n.customers || []).join(', ') || 'kein Kunde zugeordnet') + '</div></div>'
    + '<div class="ntotal">' + money(n.total) + '<small>Gesamt bisher</small></div></div>'
    + '<div class="nbd">'
      + '<div><em>Anrufe</em><b>' + (n.connected_calls || 0) + '</b></div>'
      + '<div><em>Abger. Min</em><b>' + (n.billed_minutes || 0) + '</b></div>'
      + '<div><em>Twilio (' + money(n.twilio_rate) + '/Min)</em><b>' + money(n.twilio) + '</b></div>'
      + '<div><em>Retell</em><b>' + money(n.retell) + '</b></div>'
      + '<div><em>SMS</em><b>' + money(n.sms) + '</b></div>'
    + '</div></div>';
}
function costBlock(c) {
  const co = c.cost || {};
  const capped = co.capped ? '<div class="hint" style="margin:-8px 0 12px">Kosten der letzten 500 Anrufe.</div>' : '';
  return '<div class="cost">'
    + '<div class="total"><small>Bisher genutzt (diese Nummer)</small><b>' + money(co.total) + '</b></div>'
    + '<div class="bd">'
      + '<span>Anrufe: <b>' + (co.connected_calls || 0) + '</b></span>'
      + '<span>Retell: <b>' + money(co.retell) + '</b></span>'
      + '<span>Twilio: <b>' + money(co.twilio) + '</b> (' + (co.billed_minutes || 0) + ' Min à ' + money(co.twilio_rate) + ')</span>'
      + '<span>SMS: <b>' + (co.sms_count || 0) + '</b> (' + money(co.sms) + ')</span>'
    + '</div></div>' + capped;
}
function renderCustomer(c) {
  const st=c.stats||{};
  const minOn=Number(c.minutes_budget)>0;
  const smsOn=c.sms_enabled!==false;
  const daOn=c.detailed_analysis===true;
  const bookOn=c.booking_enabled===true;
  const provider=c.provider==='elevenlabs'?'elevenlabs':'retell';
  const providerLabel=provider==='elevenlabs'?'ElevenLabs':'Retell';
  const activeAgent=provider==='elevenlabs'?(c.elevenlabs_agent_id||''):(c.retell_agent_id||'');
  return '<div class="cust" data-id="'+esc(c.id)+'">'
    + '<div class="cust-top">'
      + '<div class="cust-id"><div class="avatar">'+esc(initials(c.name))+'</div>'
        + '<div><strong>'+esc(c.name)+'</strong><span>'+esc(providerLabel)+' · '+esc(activeAgent||'kein Agent')+(c.retell_from_number?' · '+esc(c.retell_from_number):'')+'</span></div></div>'
      + '<div class="cust-metrics"><div><b>'+(st.calls||0)+'</b><span>Anrufe</span></div><div><b style="font-size:14px;color:#48607d">'+esc(fmt(st.lastAt))+'</b><span>zuletzt</span></div></div>'
    + '</div>'
    + (c.login_linked === false ? '<p class="msg err">Zugang noch nicht verknüpft. Bitte die Kunden-Mitgliedschaft in Supabase ergänzen.</p>' : '')
    + '<details class="det"><summary>Leistungen & Einstellungen</summary><div class="toggles">'
      + '<div class="tg"><div class="lbl">Live-Minuten<small>Testphase</small></div><label class="switch"><input type="checkbox" class="min-toggle" '+(minOn?'checked':'')+'><span class="slider"></span></label></div>'
      + '<div class="tg"><div class="lbl">SMS nach Anruf</div><label class="switch"><input type="checkbox" class="sms-toggle" '+(smsOn?'checked':'')+'><span class="slider"></span></label></div>'
      + '<div class="tg"><div class="lbl">Detaillierte Analyse<small>Transkripte pro Anruf</small></div><label class="switch"><input type="checkbox" class="da-toggle" '+(daOn?'checked':'')+'><span class="slider"></span></label></div>'
      + '<div class="tg"><div class="lbl">Terminbuchung<small>Cal.com pro Anruf</small></div><label class="switch"><input type="checkbox" class="book-toggle" '+(bookOn?'checked':'')+'><span class="slider"></span></label></div>'
    + '</div>'
    + '<div class="field" style="margin-bottom:12px"><label>Minuten-Budget (0 = ausblenden)</label><input class="f-minutes" type="number" min="0" max="1000000" oninput="this.closest(\'.cust\').querySelector(\'.min-toggle\').checked=Number(this.value)>0" value="'+esc(minOn?c.minutes_budget:'')+'" placeholder="z. B. 200"></div>'
    + '<div class="reset-controls"><strong>Zählung & Gesprächszeitraum</strong><p>Das Budget bleibt erhalten. Resets gelten für diesen Kunden auf allen Geräten.</p><button class="btn btn-ghost" onclick="resetCustomerUsage(this,\'minutes\')">Minuten ab jetzt neu zählen</button><p class="reset-minutes-at">'+(c.minutes_reset_at?'Zählung seit '+esc(fmt(c.minutes_reset_at)):'Noch kein Minutenreset')+'</p><button class="btn btn-ghost" onclick="resetCustomerUsage(this,\'conversations\')">Gesprächsansicht ab jetzt beginnen</button><p class="reset-conversations-at">'+(c.go_live_at?'Gespräche sichtbar ab '+esc(fmt(c.go_live_at)):'Alle verfügbaren Gespräche sichtbar')+'</p></div>'
    + '<details class="det"><summary>Einstellungen & SMS-Nachricht bearbeiten</summary><div class="inner">'
      + '<div class="grid2"><div class="field"><label>Voice-Provider</label><select class="f-provider">'
        + '<option value="retell"'+(provider==='retell'?' selected':'')+'>Retell</option>'
        + '<option value="elevenlabs"'+(provider==='elevenlabs'?' selected':'')+'>ElevenLabs</option></select></div>'
      + '<div class="field"><label>Voice Agent ID ('+esc(providerLabel)+')</label><input class="f-agent" value="'+esc(activeAgent)+'"></div></div>'
      + '<div class="field"><label>Telefonnummer</label><input class="f-phone" value="'+esc(c.retell_from_number)+'"></div>'
      + '<div class="field"><label>Buchungslink</label><input class="f-booking" value="'+esc(c.booking_link_url)+'"></div>'
      + '<div class="field"><label>SMS-Absender (Name max. 11 Zeichen <b>oder</b> +49… Nummer für Feedback-Antworten)</label><input class="f-sender" placeholder="z. B. BeautyWorld" value="'+esc(c.sms_sender)+'"></div>'
      + '<div class="field"><label>SMS-Nachricht ({booking_link} = Link, {feedback_link} = Bewertung)</label><textarea class="f-sms">'+esc(c.sms_template)+'</textarea></div>'
      + '<div class="field"><label style="display:flex;align-items:center;gap:8px;font-weight:400"><input type="checkbox" class="f-append"'+(c.append_lead_params?' checked':'')+'> Lead-Infos (Nummer, Name, Call-ID) an den Buchungslink anhängen — für Demo-/Lead-Capture-Seiten</label></div>'
      + '<div class="field"><label>Termin-SMS nach Buchung ({appointment_date}, {appointment_time}, {meeting_link})</label><textarea class="f-appt-sms" placeholder="Danke für Ihren Testanruf. Ihr Termin ist für {appointment_date} um {appointment_time} vorgemerkt. Meeting-Link: {meeting_link}">'+esc(c.sms_appointment_template)+'</textarea></div>'
      + '<div class="grid2"><div class="field"><label>Cal.com API-Key (nur wenn Terminbuchung an)</label><input class="f-calkey" placeholder="cal_live_..." value="'+esc(c.calcom_api_key)+'"></div>'
      + '<div class="field"><label>Cal.com Event-Type-ID</label><input class="f-caltype" placeholder="z. B. 1234567" value="'+esc(c.calcom_event_type_id)+'"></div></div>'
      + '<div class="field"><label>SMS abchecken: Testnummer (sendet die GESPEICHERTE Vorlage als echte SMS)</label>'
        + '<div style="display:flex;gap:8px;flex-wrap:wrap"><input class="f-testnr" type="tel" placeholder="+4917612345678" style="flex:1;min-width:180px">'
        + '<button class="btn btn-ghost" onclick="testSms(this)">Test-SMS senden</button></div></div>'
    + '</div></details>'
    + '</details><div class="cust-actions"><button class="btn btn-open" onclick="openDashboard(this)">Dashboard öffnen</button>'
      + '<button class="btn btn-main" onclick="saveCustomer(this)">Speichern</button>'
      + '<button class="btn btn-del" onclick="deleteCustomer(this)">Löschen</button></div>'
    + '<div class="cmsg"></div>'
    + '</div>';
}

async function saveCustomer(btn) {
  const card=btn.closest('.cust'), id=card.getAttribute('data-id');
  const msg=card.querySelector('.cmsg'); msg.className='cmsg'; msg.textContent='';
  const minOn=card.querySelector('.min-toggle').checked;
  const payload={ tenant_id:id,
    minutes_budget: minOn?(Number(card.querySelector('.f-minutes').value)||0):0,
    sms_enabled: card.querySelector('.sms-toggle').checked,
    detailed_analysis: card.querySelector('.da-toggle').checked,
    booking_enabled: card.querySelector('.book-toggle').checked,
    sms_template: card.querySelector('.f-sms').value,
    sms_appointment_template: card.querySelector('.f-appt-sms').value,
    calcom_api_key: card.querySelector('.f-calkey').value,
    calcom_event_type_id: card.querySelector('.f-caltype').value,
    retell_from_number: card.querySelector('.f-phone').value,
    booking_link_url: card.querySelector('.f-booking').value,
    sms_sender: card.querySelector('.f-sender').value,
    append_lead_params: card.querySelector('.f-append').checked };
  // Provider + Agent-ID in die passende Spalte schreiben, die andere leeren.
  const prov=(card.querySelector('.f-provider')&&card.querySelector('.f-provider').value)||'retell';
  const agentVal=(card.querySelector('.f-agent').value||'').trim();
  payload.provider=prov;
  if(prov==='elevenlabs'){ payload.elevenlabs_agent_id=agentVal; payload.retell_agent_id=''; }
  else { payload.retell_agent_id=agentVal; payload.elevenlabs_agent_id=''; }
  btn.disabled=true; btn.textContent='Speichert...';
  try { await api('/api/admin/update-customer',payload); msg.className='cmsg ok'; msg.textContent='Gespeichert.'; }
  catch(e){ msg.className='cmsg err'; msg.textContent='Fehler: '+(e.message||e); }
  finally { btn.disabled=false; btn.textContent='Speichern'; }
}

async function testSms(btn) {
  const card=btn.closest('.cust'), id=card.getAttribute('data-id');
  const msg=card.querySelector('.cmsg'); msg.className='cmsg'; msg.textContent='';
  const nr=(card.querySelector('.f-testnr').value||'').trim();
  if(!nr){ msg.className='cmsg err'; msg.textContent='Bitte Testnummer eingeben, z. B. +4917612345678.'; return; }
  if(!confirm('Echte SMS an '+nr+' senden? (Es wird die zuletzt GESPEICHERTE Vorlage verwendet - erst speichern, dann testen.)')) return;
  btn.disabled=true; btn.textContent='Sendet...';
  try {
    const d=await api('/api/admin/test-sms',{tenant_id:id,to_number:nr});
    msg.className='cmsg ok'; msg.textContent='Test-SMS gesendet an '+nr+': "'+String(d.message_preview||'').slice(0,80)+'..."';
  } catch(e){ msg.className='cmsg err'; msg.textContent='Fehler: '+(e.message||e); }
  finally { btn.disabled=false; btn.textContent='Test-SMS senden'; }
}

async function openDashboard(btn) {
  if (adminPreview) { window.open('/?preview=1','_blank'); return; }
  const card=btn.closest('.cust'), id=card.getAttribute('data-id');
  const msg=card.querySelector('.cmsg'); msg.className='cmsg'; msg.textContent='Session wird erstellt...';
  const dashboardTab = window.open('about:blank', '_blank');
  if (!dashboardTab) { msg.textContent='Bitte Pop-ups erlauben und erneut öffnen.'; return; }
  btn.disabled=true;
  try {
    const d=await api('/api/admin/impersonate',{tenant_id:id});
    // Token nur ueber die URL (pro Tab) - kein gemeinsamer Speicher -> keine Datenvermischung.
    const u='/#admin_token='+encodeURIComponent(d.accessToken)+'&admin_email='+encodeURIComponent((d.user&&d.user.email)||'');
    dashboardTab.location.replace(u);
    msg.className='cmsg ok'; msg.textContent='Dashboard in neuem Tab geoeffnet.';
  } catch(e){ dashboardTab.close(); msg.className='cmsg err'; msg.textContent='Fehler: '+(e.message||e); }
  finally { btn.disabled=false; }
}

async function deleteCustomer(btn) {
  const card=btn.closest('.cust'), id=card.getAttribute('data-id');
  const name=card.querySelector('.cust-id strong').textContent;
  if(!confirm('Kunde "'+name+'" wirklich löschen? Login, Daten und Zugang werden dauerhaft aus Supabase entfernt.')) return;
  const msg=card.querySelector('.cmsg'); msg.className='cmsg'; msg.textContent='Wird geloescht...';
  btn.disabled=true;
  try { await api('/api/admin/delete-customer',{tenant_id:id}); card.remove(); }
  catch(e){ msg.className='cmsg err'; msg.textContent='Fehler: '+(e.message||e); btn.disabled=false; }
}

async function createCustomer() {
  const m=document.getElementById('create-msg'); m.className='msg'; m.textContent='';
  const v=(id)=>(document.getElementById(id).value||'').trim();
  const payload={ name:v('c-name'), email:v('c-email'), password:v('c-password'), provider:v('c-provider')||'retell', agent_id:v('c-agent'), from_number:v('c-phone'), booking_link:v('c-booking') };
  if(!payload.name||!payload.email||!payload.password||!payload.agent_id){ m.className='msg err'; m.textContent='Bitte Firmenname, E-Mail, Passwort und Agent ID ausfuellen.'; return; }
  const button=document.getElementById('create-button'); button.disabled=true;
  m.textContent='Agent wird geprüft und Zugang eingerichtet…';
  try {
    await api('/api/admin/create-customer',payload);
    m.className='msg ok'; m.textContent='Kunde angelegt: '+payload.email;
    ['c-name','c-email','c-password','c-agent','c-phone','c-booking'].forEach((id)=>{ document.getElementById(id).value=''; });
    loadCustomers();
  } catch(e){ m.className='msg err'; m.textContent='Fehler: '+(e.message||e); }
  finally { button.disabled=false; }
}
document.getElementById('admin_secret').addEventListener('keydown',(e)=>{ if(e.key==='Enter') login(); });

if(adminPreview){ document.getElementById('login-card').classList.add('hidden'); document.getElementById('app').classList.remove('hidden'); document.getElementById('top-info').textContent='Design-Vorschau · Beispieldaten'; loadCustomers(); }

function adminLogout(){ if(adminPreview){location.href="/admin";return;} document.getElementById("admin-logout").classList.add("hidden"); ADMIN=""; document.getElementById("admin_secret").value=""; document.getElementById("app").classList.add("hidden"); document.getElementById("login-card").classList.remove("hidden"); document.getElementById("top-info").textContent=""; }

async function resetCustomerUsage(btn,mode) {
  const card=btn.closest('.cust'),id=card.dataset.id;
  const name=card.querySelector('.cust-id strong').textContent;
  const question=mode==='minutes'?'Minutenverbrauch für '+name+' ab jetzt bei 0 beginnen? Das Minutenbudget und die Gespräche bleiben erhalten.':'Frühere Gespräche und Rückrufe für '+name+' ab jetzt ausblenden? Auch offene ältere Rückrufe werden ausgeblendet. Die Minuten-Zählung bleibt unverändert.';
  if(!confirm(question))return;
  const msg=card.querySelector('.cmsg');btn.disabled=true;msg.textContent='Speichert…';
  try {
    const result=await api('/api/admin/reset-usage',{tenant_id:id,mode});
    msg.className='cmsg ok';msg.textContent=result.message;
    card.querySelector('.reset-'+mode+'-at').textContent=(mode==='minutes'?'Zählung seit ':'Gespräche sichtbar ab ')+fmt(result.reset_at);
  }catch(e){msg.className='cmsg err';msg.textContent=e.message;}
  finally{btn.disabled=false;}
}

// Link zum Beispiel-Dashboard in die Zwischenablage - zum Verschicken vor einem Termin.
function copyDemoLink(button) {
  const url = location.origin + '/demo';
  const done = () => { const old = button.textContent; button.textContent = 'Link kopiert'; setTimeout(() => { button.textContent = old; }, 2000); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done).catch(() => window.prompt('Link kopieren:', url));
  else window.prompt('Link kopieren:', url);
}
