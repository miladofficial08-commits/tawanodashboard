function serverUrl() { return defaultServerUrl().replace(/\/$/, ''); }
function authHeaders() { return { 'Content-Type': 'application/json', Authorization: 'Bearer ' + authToken }; }
function isLocalHost() {
  const host = location.hostname || '';
  return host === 'localhost' || host === '127.0.0.1';
}
function buildApiBases() {
  const primary = serverUrl();
  return [primary];
}
async function parseJsonSafe(res) {
  const raw = await res.text();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (_) {
    throw new Error('Antwort vom Server ist kein gueltiges JSON.');
  }
}
async function fetchApi(path, init) {
  const bases = buildApiBases();
  let lastError = null;
  for (let i = 0; i < bases.length; i += 1) {
    const base = bases[i];
    try {
      const res = await fetch(base + path, init);
      const mustFallback = isLocalHost() && i === 0 && (res.status === 404 || res.status === 405);
      if (mustFallback) continue;
      const data = await parseJsonSafe(res);
      return { res, data };
    } catch (error) {
      lastError = error;
      const hasFallback = i < bases.length - 1;
      if (!hasFallback) throw error;
    }
  }
  throw lastError || new Error('API nicht erreichbar.');
}
function escHtml(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
let timeFormatter = null; // wiederverwenden statt je Anruf neu bauen
function fmtTime(iso) {
  if (!iso) return '-';
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '-';
  if (!timeFormatter) timeFormatter = new Intl.DateTimeFormat('de-DE', { timeZone:'Europe/Berlin', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  return timeFormatter.format(date);
}
function isToday(iso) { if (!iso) return false; const a = new Date(iso); const b = new Date(); return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function isThisWeek(iso) {
  if (!iso) return false;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  const day = (now.getDay() + 6) % 7;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(now.getDate() - day);
  return date >= start;
}
function formatMoney(value) { return new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 }).format(Math.max(0, Math.round(value || 0))); }
function formatRange(range) { return formatMoney(range.min) + ' € – ' + formatMoney(range.max) + ' €'; }
function mergeRanges(items) {
  return items.reduce((acc, item) => ({ min: acc.min + item.value.min, max: acc.max + item.value.max }), { min: 0, max: 0 });
}
function callKey(call) {
  return String(call.call_id || call.callId || call.id || [call.createdAt, call.phoneNumber || call.to_number || call.toNumber || '', call.summary || ''].join('|'));
}
function isTaskMarkedDone(call) {
  return call.work ? call.work.state === 'done' : false;
}
function whatsappNumber(phone) {
  return String(phone || '').replace(/[^\d]/g, '');
}
function normalizePhoneDe(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let cleaned = raw.replace(/[\s\-()/.]/g, '');
  if (cleaned.startsWith('00')) cleaned = '+' + cleaned.slice(2);
  if (cleaned.startsWith('+')) return /^\+[1-9]\d{7,14}$/.test(cleaned) ? cleaned : '';
  if (cleaned.startsWith('0')) cleaned = '+49' + cleaned.slice(1);
  else if (!cleaned.startsWith('49')) cleaned = '+49' + cleaned;
  else cleaned = '+' + cleaned;
  return /^\+[1-9]\d{7,14}$/.test(cleaned) ? cleaned : '';
}
function phoneDigits(value) {
  return String(value || '').replace(/\D/g, '');
}
function customerPhone(call) {
  const direct = String(call && call.phoneNumber || '').trim();
  const from = String(call && (call.from_number || call.fromNumber) || '').trim();
  const to = String(call && (call.to_number || call.toNumber) || '').trim();
  if (call && call.provider === 'elevenlabs') return direct || from;
  // Kundennummer nie = eigene Business-Nummer. Anrufrichtung ist am zuverlaessigsten:
  // inbound -> Kunde = from_number, outbound -> Kunde = to_number.
  const direction = String(call && call.direction || '').toLowerCase();
  if (direction === 'inbound') return from || direct;
  if (direction === 'outbound') return to || direct;
  const tenantFrom = String(currentTenant && currentTenant.retell_from_number || '').trim();
  if (from && tenantFrom && phoneDigits(from) === phoneDigits(tenantFrom)) return to || direct || from;
  return direct || from || to;
}
function toGermanCallError(message) {
  const txt = String(message || '');
  const lower = txt.toLowerCase();
  if (lower.includes('e.164') || lower.includes('valid number')) {
    return 'Telefonnummer ungueltig. Bitte im internationalen Format eingeben, z. B. +491631283971.';
  }
  return txt;
}

function setStatus(state, text) {
  const pill = document.getElementById('status-pill');
  pill.className = 'status' + (state ? ' ' + state : '');
  document.getElementById('status-text').textContent = text;
}
function setAuthInfo(text, type) {
  const el = document.getElementById('auth-info');
  el.className = 'auth-info' + (type ? ' ' + type : '');
  el.textContent = text;
}
function showMsg(text, type) {
  const el = document.getElementById('call-msg');
  el.className = 'message ' + type;
  el.textContent = text;
}
function showDashboard() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('dashboard-screen').classList.remove('hidden');
  document.getElementById('user-email').textContent = currentUser && currentUser.email ? currentUser.email : '';
  syncRefreshTimer();
}
function showLogin() {
  document.getElementById('dashboard-screen').classList.add('hidden');
  document.getElementById('login-screen').classList.remove('hidden');
  syncRefreshTimer();
}

function customerLabel(call) {
  const name = String(call.customerName || call.name || '').trim();
  if (name) return name;
  const phone = customerPhone(call);
  if (phone) return 'Anrufer ' + phone;
  return 'Neue Anfrage';
}
function textStamp(call) {
  return String(call.summary || '') + '|' + String(call.disconnectionReason || call.disconnection_reason || '');
}
function fullSummaryText(call) {
  return memoOnCall(call, '_text', textStamp(call), () => computeSummaryText(call));
}
function computeSummaryText(call) {
  const analysis = call.callAnalysis || call.call_analysis || {};
  const custom = analysis.custom_analysis_data || {};
  const parts = [
    custom.summary,
    custom.reason,
    custom.intent,
    analysis.call_summary,
    analysis.summary,
    call.summary,
    call.disconnectionReason,
    call.disconnection_reason,
  ];
  return parts.filter(Boolean).join(' | ').toLowerCase();
}
function englishSummaryDetected(text) {
  const t = String(text || '').toLowerCase();
  if (!t) return false;
  return /\b(the|agent|user|call|conversation|greeting|hang up|hung up|almost immediately|ending)\b/.test(t);
}
function simpleEnglishToGerman(text) {
  const t = String(text || '').toLowerCase();
  if (!t) return '';
  const parts = [];
  if (t.includes('agent') || t.includes('the agent') || t.includes('agent began') || t.includes('agent introduced')) parts.push('Der Agent stellte sich vor und erklärte das Angebot.');
  if (t.includes('disconnected by the user') || t.includes('user_hangup') || t.includes('user hangup') || t.includes('hang up') || t.includes('hung up') || t.includes('disconnected')) parts.push('Der Anrufer hat aufgelegt.');
  if (t.includes('booking') || t.includes('book') || t.includes('booking tool')) parts.push('Problem mit Buchung/Terminvereinbarung.');
  if (t.includes('mailbox') || t.includes('voicemail')) parts.push('Mailbox erreicht / Rückruf erforderlich.');
  if (t.includes('callback') || t.includes('call back') || t.includes('call back request')) parts.push('Der Kunde möchte einen Rückruf.');
  if (t.includes('error') || t.includes('technical') || t.includes('failed')) parts.push('Technisches Problem erkannt.');
  return parts.join(' ');
}
function summaryFor(call) {
  const analysis = call.callAnalysis || call.call_analysis || {};
  const custom = analysis.custom_analysis_data || {};
  const directSummary = String(custom.summary || analysis.call_summary || analysis.summary || call.summary || '').trim();
  if (directSummary) {
    if (englishSummaryDetected(directSummary)) {
      const auto = simpleEnglishToGerman(directSummary);
      if (auto) return auto.length > 220 ? (auto.slice(0, 217) + '...') : auto;
    } else {
      return directSummary.length > 220 ? (directSummary.slice(0, 217) + '...') : directSummary;
    }
  }
  const raw = fullSummaryText(call);
  const reason = String(call.disconnectionReason || call.disconnection_reason || '').toLowerCase();
  if (raw.includes('mailbox') || reason.includes('voicemail')) return 'Der Kunde war nicht erreichbar und braucht einen Rückruf.';
  if (raw.includes('rueckruf') || raw.includes('zurueckruf') || raw.includes('callback')) return 'Der Kunde möchte zurückgerufen werden.';
  if (raw.includes('transfer') || raw.includes('weiter') || raw.includes('staff member')) return 'Das Gespräch sollte weitergeleitet werden.';
  if (raw.includes('appointment') || raw.includes('book') || raw.includes('termin')) return 'Der Kunde wollte einen Termin vereinbaren.';
  if (raw.includes('preis') || raw.includes('kosten') || raw.includes('angebot') || raw.includes('price')) return 'Der Kunde hatte eine Frage zu Preis oder Angebot.';
  if (raw.includes('beschwerde') || raw.includes('problem') || raw.includes('fehler') || raw.includes('technical error')) return 'Es gab ein Problem im Gespräch und Nachfassen ist sinnvoll.';
  if (raw.includes('aufgelegt') || raw.includes('hang up') || raw.includes('hung up')) return 'Das Gespräch wurde schnell beendet.';
  // Ohne Zusammenfassung des Anbieters wenigstens sagen, was wirklich bekannt ist -
  // "Das Gespräch wurde kurz zusammengefasst." hat dem Handwerker nichts gebracht.
  const seconds = Math.round((Number(call.durationMs) || 0) / 1000);
  if (seconds > 0 && seconds < 20) return 'Sehr kurzer Anruf (' + seconds + ' Sek). Es kam kein Anliegen zur Sprache.';
  if (reason.includes('remote') || reason.includes('user_hangup')) return 'Der Anrufer hat aufgelegt, bevor ein Anliegen erfasst wurde.';
  if (seconds > 0) return 'Anruf über ' + (seconds >= 60 ? Math.round(seconds / 60) + ' Min' : seconds + ' Sek') + '. Der Anbieter hat keine Zusammenfassung geliefert.';
  return 'Zu diesem Anruf liegt keine Zusammenfassung vor.';
}
function callFlags(call) {
  const txt = fullSummaryText(call);
  const status = String(call.status || call.retellStatus || '').toLowerCase();
  const reason = String(call.disconnectionReason || call.disconnection_reason || '').toLowerCase();
  const transfer = txt.includes('transfer') || txt.includes('weiter') || reason.includes('transfer');
  const callback = txt.includes('rueckruf') || txt.includes('zurueckruf') || txt.includes('callback') || txt.includes('mailbox') || reason.includes('voicemail');
  const problem = status.includes('error') || status.includes('network') || txt.includes('beschwerde') || txt.includes('problem') || txt.includes('fehler') || txt.includes('nicht erreicht');
  return { transfer, callback, problem };
}
function classifyCall(call) {
  return memoOnCall(call, '_classify', workStamp(call), () => computeClassification(call));
}
function computeClassification(call) {
  if (isTaskMarkedDone(call)) return { key:'done', label:'Erledigt', badge:'done', next:'Bereits erledigt' };
  if (call.work?.state_manual && call.work.state === 'open') return {key:'callback',label:'Offen',badge:'callback',next:'Anliegen bearbeiten'};
  const status = String(call.status || call.retellStatus || '').toLowerCase();
  const reason = String(call.disconnectionReason || call.disconnection_reason || '').toLowerCase();
  const text = summaryFor(call).toLowerCase();
  if (['ongoing','in-progress','starting','registered'].includes(status)) return { key:'live', label:'Im Gespräch', badge:'live', next:'Läuft gerade' };
  if (status.includes('error') || status.includes('network')) return { key:'problem', label:'Problemfall', badge:'problem', next:'Sofort prüfen' };
  // Hat der Telefonassistent eine Rueckrufzeit strukturiert geliefert, ist das Anliegen
  // eindeutig - unabhaengig davon, wie die Zusammenfassung formuliert ist.
  if (typeof callbackFieldsFor === 'function' && typeof PlannerTime !== 'undefined'
    && PlannerTime.fromStructured(callbackFieldsFor(call), call.createdAt)) return { key:'callback', label:'Rückruf', badge:'callback', next:'Zurückrufen' };
  if (text.includes('weitergeleitet') || reason.includes('transfer')) return { key:'transfer', label:'Weitergeleitet', badge:'transfer', next:'Übernahme im Team prüfen' };
  const noCallback = /kein(?:en)? r[üu]e?ckruf|r[üu]e?ckruf (?:ist )?nicht (?:nötig|erforderlich)/.test(text);
  if (!noCallback && /mailbox|rückruf|rueckruf|zurückrufen|zurueckrufen/.test(text)) return { key:'callback', label:'Rückruf', badge:'callback', next:'Zurückrufen' };
  if (/angebot|reparatur|besichtigung|sanierung|auftrag/.test(text)) return { key:'callback', label:'Neue Anfrage', badge:'callback', next:'Anfrage prüfen und Kontakt aufnehmen' };
  if (/öffnungszeiten|oeffnungszeiten|adresse/.test(text) && /genannt|erhalten|beantwortet|mitgeteilt/.test(text)) return { key:'done', label:'Beantwortet', badge:'done', next:'Information wurde mitgeteilt' };
  return { key:'problem', label:'Bitte prüfen', badge:'problem', next:'Gespräch öffnen und Anliegen prüfen' };
}
function topicFromCall(call) {
  return memoOnCall(call, '_topic', textStamp(call), () => computeTopic(call));
}
function computeTopic(call) {
  const txt = fullSummaryText(call);
  if (txt.includes('termin') || txt.includes('buchung') || txt.includes('appointment') || txt.includes('book')) return 'Termine';
  if (txt.includes('preis') || txt.includes('kosten') || txt.includes('angebot') || txt.includes('price')) return 'Angebote';
  if (txt.includes('oeffnungszeit') || txt.includes('adresse') || txt.includes('standort') || txt.includes('hours')) return 'Öffnungszeiten';
  if (txt.includes('weiter') || txt.includes('transfer')) return 'Weiterleitung';
  if (txt.includes('rueckruf') || txt.includes('zurueckruf') || txt.includes('callback')) return 'Rückruf';
  if (txt.includes('beschwerde') || txt.includes('problem') || txt.includes('fehler')) return 'Problem';
  return 'Sonstiges';
}
function issueFromCall(call) {
  const txt = fullSummaryText(call);
  const status = String(call.status || call.retellStatus || '').toLowerCase();
  const reason = String(call.disconnectionReason || call.disconnection_reason || '').toLowerCase();
  if (status.includes('error') || status.includes('network')) return 'Technikfehler';
  if (txt.includes('mailbox') || reason.includes('voicemail')) return 'Mailbox/kein Kontakt';
  if (txt.includes('beschwerde') || txt.includes('unzufrieden')) return 'Kundenbeschwerde';
  if (txt.includes('nicht erreicht') || txt.includes('keine antwort')) return 'Kunde nicht erreicht';
  return 'Kein Problem';
}
function topEntries(mapObj, limit) {
  return Object.entries(mapObj).sort((a, b) => b[1] - a[1]).slice(0, limit);
}
function priorityForItem(info) {
  if (info.key === 'problem') return { label: 'Hoch', className: 'high', rank: 0 };
  if (info.key === 'callback') return { label: 'Hoch', className: 'high', rank: 1 };
  if (info.key === 'transfer') return { label: 'Mittel', className: 'medium', rank: 2 };
  return { label: 'Niedrig', className: 'low', rank: 3 };
}
function concernForCall(call, info) {
  return summaryFor(call);
}
function buildItemModel(call) {
  const info = classifyCall(call);
  const priority = priorityForItem(info);
  const nextStep = nextStepForCall(call, info);
  return {
    call,
    key: callKey(call),
    info,
    priority,
    concern: concernForCall(call, info),
    summary: summaryFor(call),
    nextStep,
    phone: customerPhone(call),
    customer: customerLabel(call),
    createdAt: call.createdAt || call.updatedAt || null,
  };
}
function sortItems(items) {
  return items.slice().sort((a, b) => {
    if (a.priority.rank !== b.priority.rank) return a.priority.rank - b.priority.rank;
    return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
  });
}
function recommendationText(todayItems, topicCounts) {
  if (!todayItems.length) return 'Noch keine Empfehlung. Sobald Gespräche eingehen, erscheint hier der wichtigste Verbesserungsschritt.';
  const problems = todayItems.filter((item) => item.info.key === 'problem').length;
  const callbacks = todayItems.filter((item) => item.info.key === 'callback').length;
  const topTopic = topEntries(topicCounts, 1)[0];
  if (problems >= 2) return 'Heute gab es mehrere Problemfälle. Prüfe diese Gespräche zuerst und verbessere die Stellen, an denen der Agent hängen bleibt.';
  if (topTopic && topTopic[0] === 'Öffnungszeiten') return 'Viele Kunden fragen nach Öffnungszeiten oder Adresse. Ergänze diese Infos klar im Agenten-Wissen.';
  if (topTopic && topTopic[0] === 'Preise') return 'Viele Kunden fragen nach Preisen. Ergänze Preisspannen oder Standardangebote im Agenten-Wissen.';
  if (callbacks >= 2) return 'Heute wollten mehrere Kunden zurückgerufen werden. Prüfe, ob der Agent öfter direkt Termine buchen oder sicherer weiterleiten sollte.';
  return 'Das Gesprächsmuster ist stabil. Beobachte weiter, welche Fragen häufig wiederkommen, und ergänze diese im Agenten-Wissen.';
}
function renderInsights(todayItems) {
  const topicCounts = {};
  todayItems.forEach((item) => {
    topicCounts[topicFromCall(item.call)] = (topicCounts[topicFromCall(item.call)] || 0) + 1;
  });
  const total = Math.max(1, todayItems.length);
  const callbacks = todayItems.filter((item) => item.info.key === 'callback').length;
  const urgent = todayItems.filter((item) => item.info.key === 'problem').length;
  const topTopic = topEntries(topicCounts, 1)[0];
  const summary = !todayItems.length
    ? 'Heute gibt es noch keine Gespräche. Sobald Anrufe eingehen, erscheint hier eine klare Tagesauswertung.'
    : 'Heute wollten die meisten Kunden ' + escHtml((topTopic && topTopic[0].toLowerCase()) || 'Hilfe') + '. '
      + (urgent ? urgent + ' Gespräche waren dringend. ' : 'Es gab keine kritischen Gespräche. ')
      + (callbacks ? callbacks + ' Kunden brauchen einen Rückruf.' : 'Es ist kein Rückruf offen.');
  document.getElementById('ai-summary').innerHTML = summary;

  const topicWrap = document.getElementById('ai-topics');
  const entries = topEntries(topicCounts, 4);
  topicWrap.innerHTML = entries.length
    ? entries.map(([name, count]) => '<div class="insight-item"><strong>' + escHtml(name) + '</strong><span>' + escHtml(Math.round((count / total) * 100)) + ' %</span></div>').join('')
    : '<div class="empty">Noch keine Werte.</div>';

  document.getElementById('ai-recommendation').textContent = recommendationText(todayItems, topicCounts);
}
function resetDashboardData() { setStatus('err','Resets werden in der Tawano Verwaltung durchgeführt.'); }

async function loginWithPassword() {
  const email = (document.getElementById('login-email').value || '').trim();
  const password = document.getElementById('login-password').value || '';
  if (!email || !password) { setAuthInfo('Bitte E-Mail und Passwort eingeben.', 'err'); return; }
  setAuthInfo('Login wird geprueft...', '');
  try {
    let result;
    try {
      result = await fetchApi('/api/client-auth/login', {
        method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ email, password })
      });
      // if server returned 404/405 HTML page, try direct function path as fallback
      if (result && result.res && (result.res.status === 404 || result.res.status === 405)) {
        result = await fetchApi('/.netlify/functions/client-auth-login', {
          method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ email, password })
        });
      }
    } catch (err) {
      // try a direct function call as a last resort
      result = await fetchApi('/.netlify/functions/client-auth-login', {
        method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ email, password })
      });
    }
    const res = result.res;
    const data = result.data;
    if (!res.ok || !data.ok || !data.accessToken) throw new Error(data.message || 'Login fehlgeschlagen');
    authToken = data.accessToken;
    currentUser = data.user || { email };
    localStorage.setItem('tawano_access_token', authToken);
    localStorage.setItem('tawano_user', JSON.stringify(currentUser));
    setAuthInfo('Eingeloggt.', 'ok');
    showDashboard();
    refreshCalls();
  } catch (error) {
    setAuthInfo('Login fehlgeschlagen: ' + String(error.message || error), 'err');
  }
}

function logout() {
  if (previewMode) { location.href = '/Dashboardkunde.html'; return; }
  authToken = '';
  currentUser = null;
  calls = [];
  localStorage.removeItem('tawano_access_token');
  localStorage.removeItem('tawano_user');
  sessionStorage.removeItem('tawano_imp_token');
  sessionStorage.removeItem('tawano_imp_user');
  showLogin();
}

async function startTestCall() {
  if (previewMode) { showMsg('In der Vorschau werden keine Anrufe gestartet.', ''); return; }
  if (!authToken) { showMsg('Bitte zuerst einloggen.', 'err'); return; }
  const inputPhone = (document.getElementById('phone').value || '').trim();
  if (!inputPhone) { showMsg('Bitte Telefonnummer eingeben.', 'err'); return; }
  const phone = normalizePhoneDe(inputPhone);
  if (!phone) { showMsg('Bitte gueltige Nummer eingeben, z. B. +491631283971.', 'err'); return; }
  document.getElementById('phone').value = phone;
  showMsg('Test-Call wird gestartet...', 'ok');
  try {
    const result = await fetchApi('/api/call', {
      method:'POST', headers:authHeaders(), body:JSON.stringify({ phoneNumber: phone })
    });
    const res = result.res;
    const data = result.data;
    if (!res.ok || !data.ok) throw new Error(data.message || 'Test-Call konnte nicht gestartet werden');
    showMsg('Test-Call gestartet.', 'ok');
    refreshCalls();
  } catch (error) {
    showMsg('Fehler: ' + toGermanCallError(error.message), 'err');
  }
}

