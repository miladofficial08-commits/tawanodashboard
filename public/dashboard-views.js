async function refreshCalls() {
  if (previewMode) { render(); setStatus('ok', 'Beispieldaten'); return; }
  if (!authToken || workSaving) return;
  const revision = workRevision;
  const refreshToken = authToken;
  setStatus('', 'Aktualisiert...');
  try {
    let res;
    let data;
    try {
      const result = await fetchApi('/api/debug/calls', { cache:'no-store', headers:authHeaders() });
      res = result.res;
      data = result.data;
    } catch (_) {
      const fallback = await fetchApi('/.netlify/functions/debug-calls', { cache:'no-store', headers:authHeaders() });
      res = fallback.res;
      data = fallback.data;
    }
    if (res.status === 401 || res.status === 403) { setStatus('err', 'Login abgelaufen'); logout(); return; }
    if (!res.ok || !data.ok) throw new Error(data.message || ('HTTP ' + res.status));
    if (revision !== workRevision || workSaving || authToken !== refreshToken) return;
    currentTenant = data.tenant || currentTenant;
    // Das Backend liefert bereits nur die Anrufe DIESES Kunden (nach seinem Agent gefiltert).
    // Kein fester Agent-Filter mehr im Frontend -> funktioniert fuer jeden Kunden (Multi-Tenant).
    calls = Array.isArray(data.calls) ? data.calls : [];
    callbackRequests = Array.isArray(data.callbacks) ? data.callbacks : [];
    render();
    setStatus('ok', 'Aktuell');
    // historyPending: der Anbieter-Rueckstand ist noch nicht komplett nachgearbeitet
    // (grosser Erstimport oder lange Pause) - der naechste Abruf holt weiter auf.
    const history = data.historyLimited
      ? ' · Anzeige auf 10.000 Gespräche begrenzt; Kennzahlen sind unvollständig.'
      : (data.historyPending
        ? ' · Ältere Gespräche werden noch nachgeladen. Bitte gleich erneut aktualisieren.'
        : ' · Vollständige gespeicherte Historie.');
    document.getElementById('data-notice').textContent = 'Zuletzt aktualisiert: ' + new Date().toLocaleTimeString('de-DE', {hour:'2-digit',minute:'2-digit'}) + history;
  } catch (error) {
    setStatus('err', 'Nicht aktuell');
    document.getElementById('data-notice').textContent = 'Anrufe konnten nicht geladen werden. ' + error.message + ' Vorhandene Daten können veraltet sein. Bitte erneut aktualisieren.';
    console.error(error);
  }
}

function renderCurrentList() {
  renderList(calls.map(buildItemModel));
}
function setFilter(filter) {
  activeFilter = filter;
  showAllCalls = false;
  ['all','callback','transfer','done'].forEach((name) => {
    const el = document.getElementById('filter-' + name);
    if (el) el.classList.toggle('active', name === filter);
  });
  renderCurrentList();
}
function setSort(order) {
  sortOrder = order === 'old' ? 'old' : 'new';
  renderCurrentList();
}


function render() {
  const brandEl = document.getElementById('tenant-brand');
  const tenantName = String(currentTenant && currentTenant.name || '').trim();
  if (brandEl) brandEl.textContent = tenantName;
  if (tenantName) document.title = tenantName + ' - Dashboard';

  const items = sortItems(calls.map(buildItemModel));
  const todayItems = items.filter((item) => inSelectedPeriod(item.createdAt));
  const openItems = items.filter((item) => !['done','live'].includes(item.info.key));
  const todayCallbacks = todayItems.filter((item) => item.info.key === 'callback').length;
  const todayProblems = todayItems.filter((item) => item.info.key === 'problem').length;

  document.getElementById('k-open').textContent = String(openItems.length);
  document.getElementById('k-saved').textContent = String(todayItems.length);
  document.getElementById('k-value').textContent = Math.round(todayItems.reduce((sum, item) => sum + callBillableMin(item.call), 0)) + ' min';
  document.getElementById('k-problem').textContent = String(todayProblems);
  document.getElementById('k-open-copy').textContent = openItems.length ? 'Rückrufe und Anliegen für deinen Betrieb.' : 'Im Moment ist nichts offen.';

  document.getElementById('hero-summary').textContent = todayItems.length + ' Anrufe · ' + periodLabel() + '. ' + openItems.length + ' Anliegen warten auf dich.';
  document.getElementById('hero-note').textContent = openItems.length
    ? 'Öffne ein Gespräch oder filtere nach Rückrufen. Du findest dort die nächsten Schritte.'
    : 'Alles im Blick. Sobald neue Anrufe eingehen, findest du sie hier.';

  document.getElementById('login-open').textContent = String(openItems.length);
  document.getElementById('login-done').textContent = String(items.filter((item) => item.info.key === 'done').length);
  document.getElementById('login-today').textContent = String(todayItems.length);

  renderPeriodInsights(todayItems);
  renderMinutes();
  renderAnalytics(todayItems);
  renderContacts();
  renderList(items);
  renderTasks();
}

function renderMinutes() {
  // Budget kommt pro Kunde aus dem Tenant. Kein Budget (0/leer) -> Kreis komplett ausblenden.
  const budget = Number(currentTenant && currentTenant.minutes_budget) || 0;
  const card = document.getElementById('minutes-ring-card');
  if (budget <= 0) {
    if (card) card.classList.add('hidden');
    return;
  }
  if (card) card.classList.remove('hidden');

  const usedMin = Number.isFinite(currentTenant?.minutes_used) ? currentTenant.minutes_used : calls.reduce((sum, c) => sum + callBillableMin(c), 0);
  const left = Math.max(0, budget - usedMin);
  const frac = budget > 0 ? Math.min(1, usedMin / budget) : 0;
  const pctRaw = frac * 100;
  const circ = 301.6; // 2 * PI * 48
  const ring = document.getElementById('ring-progress');
  if (ring) {
    ring.style.strokeDashoffset = String(circ - frac * circ);
    const color = pctRaw >= 90 ? '#b42318' : (pctRaw >= 70 ? '#c96500' : '#0f8a5f');
    ring.setAttribute('stroke', color);
  }
  // Kleine Werte ehrlich anzeigen: unter 1 Min mit Nachkommastelle, unter 1 % als "<1%"
  const fmtMin = (m) => (m > 0 && m < 10) ? m.toFixed(1).replace('.', ',') : String(Math.round(m));
  const pctText = usedMin <= 0 ? '0%' : (pctRaw < 1 ? '<1%' : Math.round(pctRaw) + '%');
  const pctEl = document.getElementById('ring-pct'); if (pctEl) pctEl.textContent = pctText;
  const txtEl = document.getElementById('ring-text'); if (txtEl) txtEl.textContent = fmtMin(usedMin) + ' von ' + budget + ' Minuten genutzt';
  const leftEl = document.getElementById('ring-left'); if (leftEl) leftEl.textContent = fmtMin(left) + ' Minuten übrig';
}

function renderAnalytics(items) {
  const total = items.length;
  const topicCounts = {};
  items.forEach((it) => { const t = topicFromCall(it.call); topicCounts[t] = (topicCounts[t] || 0) + 1; });
  const callbacks = items.filter((i) => i.info.key === 'callback').length;
  const problems = items.filter((i) => i.info.key === 'problem').length;
  const minutesExact = items.reduce((s, i) => s + callBillableMin(i.call), 0);
  const minutes = Math.round(minutesExact);
  const avgMin = total ? (minutesExact / total).toFixed(1).replace('.', ',') : '0';
  const cards = [
    { label: 'Anrufe im Zeitraum', value: String(total) },
    { label: 'Gesprächsminuten', value: String(minutes) },
    { label: 'Ø Minuten / Anruf', value: avgMin },
    { label: 'Rückrufe', value: String(callbacks) },
    { label: 'Problemfälle', value: String(problems) },
    { label: 'Themen erkannt', value: String(Object.keys(topicCounts).length) },
  ];
  const cardsEl = document.getElementById('analytics-cards');
  if (cardsEl) cardsEl.innerHTML = cards.map((c) => '<div class="card"><span>' + escHtml(c.label) + '</span><strong style="font-size:26px">' + escHtml(c.value) + '</strong></div>').join('');

  const barsEl = document.getElementById('analytics-bars');
  const entries = topEntries(topicCounts, 6);
  const max = Math.max(1, ...entries.map((e) => e[1]));
  if (barsEl) {
    barsEl.innerHTML = entries.length
      ? entries.map(([name, count]) => {
          const w = Math.round((count / max) * 100);
          const share = Math.round((count / Math.max(1, total)) * 100);
          return '<div class="bar-row"><div class="bar-top"><span>' + escHtml(name) + '</span><span>' + count + ' · ' + share + ' %</span></div><div class="bar-track"><div class="bar-fill" style="width:' + w + '%"></div></div></div>';
        }).join('')
      : '<div class="empty">Noch keine Anrufe für die Analyse.</div>';
  }

  // Ergebnisse (wie enden die Gespräche)
  const outLabels = { done: 'Erledigt', callback: 'Rückruf', transfer: 'Weiterleitung', problem: 'Problemfall', live: 'Live' };
  const outColors = { done: '#0f8a5f', callback: '#c96500', transfer: '#1d4ed8', problem: '#b42318', live: '#1d4ed8' };
  const outCounts = {};
  items.forEach((it) => { const k = it.info.key; outCounts[k] = (outCounts[k] || 0) + 1; });
  const outEntries = Object.keys(outLabels).filter((k) => outCounts[k]).map((k) => [k, outCounts[k]]).sort((a, b) => b[1] - a[1]);
  const outMax = Math.max(1, ...outEntries.map((e) => e[1]));
  const outEl = document.getElementById('analytics-outcomes');
  if (outEl) outEl.innerHTML = outEntries.length ? outEntries.map(([k, c]) => {
    const w = Math.round((c / outMax) * 100); const share = Math.round((c / Math.max(1, total)) * 100);
    return '<div class="bar-row"><div class="bar-top"><span>' + escHtml(outLabels[k]) + '</span><span>' + c + ' · ' + share + ' %</span></div><div class="bar-track"><div class="bar-fill" style="width:' + w + '%;background:' + outColors[k] + '"></div></div></div>';
  }).join('') : '<div class="empty">Noch keine Daten.</div>';

  renderPeriodDays(items);

  // Uhrzeit-Verteilung (wann rufen Kunden an)
  const hours = new Array(24).fill(0);
  items.forEach(i=>{const hour=PlannerTime.clock(i.createdAt).slice(0,2);if(hour)hours[Number(hour)]+=1;});
  const hourMax = Math.max(1, ...hours);
  const hoursEl = document.getElementById('analytics-hours');
  if (hoursEl) hoursEl.innerHTML = hours.map((h, i) => { const ht = Math.round((h / hourMax) * 100); const peak = h === hourMax && h > 0; return '<div class="hb' + (peak ? ' peak' : '') + '" style="height:' + Math.max(3, ht) + '%" title="' + i + ' Uhr: ' + h + ' Anrufe"></div>'; }).join('');
}

let currentView = 'overview';
function setView(name) {
  currentView = name;
  document.querySelector('.period-bar').classList.toggle('hidden', !['overview','analyse'].includes(name));
  ['overview', 'tasks', 'kunden', 'analyse', 'feedback'].forEach((v) => {
    const el = document.getElementById('view-' + v);
    if (el) el.classList.toggle('hidden', v !== name);
  });
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.getAttribute('data-view') === name));
  window.scrollTo(0, 0);
  if (name === 'feedback') loadFeedback();
}

async function loadFeedback() {
  if (previewMode) { document.getElementById('feedback-body').textContent = 'Noch keine Bewertungen. Hier erscheinen Rückmeldungen deiner Kunden.'; return; }
  const el = document.getElementById('feedback-body');
  if (!el || !authToken) return;
  el.innerHTML = '<div class="empty">Feedback wird geladen...</div>';
  try {
    const result = await fetchApi('/api/feedback-list', { cache: 'no-store', headers: authHeaders() });
    if (!result.res.ok || !result.data.ok) throw new Error(result.data.message || 'Feedback konnte nicht geladen werden');
    const rows = Array.isArray(result.data.feedback) ? result.data.feedback : [];
    if (!rows.length) {
      el.innerHTML = '<div class="empty">Noch keine Bewertungen vorhanden.</div>';
      return;
    }
    const avg = rows.reduce((sum, row) => sum + Number(row.rating || 0), 0) / rows.length;
    el.innerHTML = '<div class="detail-meta"><div><em>Durchschnitt</em><b>' + avg.toFixed(1).replace('.', ',') + ' / 5</b></div><div><em>Bewertungen</em><b>' + rows.length + '</b></div></div>'
      + '<div class="call-list">' + rows.map((row) => '<div class="call-row"><div><strong>' + escHtml(String(row.rating) + ' / 5 Sterne') + '</strong><span>' + escHtml(row.phone_number || 'Nummer unbekannt') + '</span></div><time>' + escHtml(fmtTime(row.created_at)) + '</time></div>').join('') + '</div>';
  } catch (error) {
    el.innerHTML = '<div class="empty">' + escHtml(error.message) + '</div>';
  }
}

let showAllContacts = false;
const DEFAULT_VISIBLE_CONTACTS = 8;
function contactInitials(name, phone) {
  const n = String(name || '').trim();
  if (n) return n.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const p = String(phone || '').replace(/\D/g, '');
  return p.slice(-2) || '?';
}
function buildContacts() {
  const map = new Map();
  calls.forEach((call) => {
    const phone = customerPhone(call);
    if (!phone) return;
    if (!map.has(phone)) map.set(phone, { phone: phone, name: '', calls: [], firstAt: null, lastAt: null });
    const c = map.get(phone);
    c.calls.push(call);
    const nm = String(call.customerName || call.name || '').trim();
    if (nm && !c.name) c.name = nm;
    const t = callTimeMs(call);
    if (!c.lastAt || t > c.lastAt) c.lastAt = t;
    if (!c.firstAt || t < c.firstAt) c.firstAt = t;
  });
  const contacts = Array.from(map.values());
  contacts.forEach((c) => {
    c.callCount = c.calls.length;
    c.calls.sort((a, b) => callTimeMs(b) - callTimeMs(a));
    c.lastCall = c.calls[0];
    c.hasOpen = c.calls.some((call) => classifyCall(call).key !== 'done');
  });
  contacts.sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0));
  return contacts;
}
function toggleShowAllContacts() {
  showAllContacts = !showAllContacts;
  renderContacts();
}
function renderContacts() {
  const listEl = document.getElementById('contacts-list');
  const moreBtn = document.getElementById('more-contacts-btn');
  const subEl = document.getElementById('contacts-sub');
  if (!listEl) return;
  const searchEl = document.getElementById('contact-search');
  const q = String((searchEl && searchEl.value) || '').toLowerCase().trim();
  let contacts = buildContacts();
  const total = contacts.length;
  if (subEl) subEl.textContent = total ? (total + ' Kunde' + (total === 1 ? '' : 'n') + ' insgesamt. Klicke einen Kunden für die Historie.') : 'Jeder Anrufer mit seiner Historie.';
  if (q) contacts = contacts.filter((c) => c.phone.toLowerCase().includes(q) || (c.name || '').toLowerCase().includes(q));
  if (!contacts.length) {
    listEl.innerHTML = '<div class="empty">' + (total ? 'Kein Kunde gefunden.' : 'Noch keine Kunden.') + '</div>';
    if (moreBtn) moreBtn.classList.add('hidden');
    return;
  }
  const visible = showAllContacts ? contacts : contacts.slice(0, DEFAULT_VISIBLE_CONTACTS);
  if (moreBtn) {
    if (contacts.length <= DEFAULT_VISIBLE_CONTACTS) moreBtn.classList.add('hidden');
    else { moreBtn.classList.remove('hidden'); moreBtn.textContent = showAllContacts ? 'Weniger zeigen' : ('Mehr Kunden zeigen (' + (contacts.length - DEFAULT_VISIBLE_CONTACTS) + ')'); }
  }
  listEl.innerHTML = visible.map((c) => {
    const label = c.name || ('Anrufer ' + c.phone);
    const repeat = c.callCount > 1;
    return '<div class="contact-row" onclick="openContact(\'' + escHtml(c.phone) + '\')" role="button" tabindex="0">'
      + '<div class="contact-av ' + (c.hasOpen ? 'open' : '') + '">' + escHtml(contactInitials(c.name, c.phone)) + '</div>'
      + '<div class="contact-main"><strong>' + escHtml(label) + '</strong><span>' + escHtml(c.phone) + '</span></div>'
      + '<div class="contact-meta"><span class="contact-count ' + (repeat ? 'repeat' : '') + '">' + c.callCount + ' Anruf' + (c.callCount === 1 ? '' : 'e') + '</span><span class="contact-when">' + escHtml(fmtTime(new Date(c.lastAt).toISOString())) + '</span></div>'
      + '</div>';
  }).join('');
}
function openContact(phone) {
  const c = buildContacts().find((x) => x.phone === phone);
  if (!c) return;
  const label = c.name || ('Anrufer ' + c.phone);
  document.getElementById('contact-title').textContent = label;
  const subEl = document.getElementById('contact-sub');
  if (subEl) subEl.textContent = c.phone;

  const stats = '<div class="contact-stats">'
    + '<div><em>Anrufe</em><b>' + c.callCount + '</b></div>'
    + '<div><em>Erster Kontakt</em><b>' + escHtml(fmtTime(new Date(c.firstAt).toISOString())) + '</b></div>'
    + '<div><em>Letzter Kontakt</em><b>' + escHtml(fmtTime(new Date(c.lastAt).toISOString())) + '</b></div>'
    + '</div>';
  const actions = '<div class="contact-actions">'
    + '<button class="btn-mini primary" onclick="contactCustomer(\'call\',' + calls.indexOf(c.calls[0]) + ')">Anrufen</button>'
    + '<button class="btn-mini" onclick="contactCustomer(\'whatsapp\',' + calls.indexOf(c.calls[0]) + ')">WhatsApp</button>'
    + '</div>';
  const timeline = '<div class="detail-section"><em>Verlauf</em><div class="timeline">'
    + c.calls.map((call) => {
        const info = classifyCall(call);
        const idx = calls.indexOf(call);
        return '<div class="tl-item" onclick="closeContact(); openDetail(' + idx + ')">'
          + '<div class="tl-top"><span class="badge ' + escHtml(info.badge) + '">' + escHtml(info.label) + '</span><small>' + escHtml(fmtTime(call.createdAt)) + '</small></div>'
          + '<p>' + escHtml(summaryFor(call)) + '</p></div>';
      }).join('')
    + '</div></div>';
  document.getElementById('contact-body').innerHTML = stats + actions + timeline;
  document.getElementById('contact-overlay').classList.remove('hidden');
}
function closeContact(event) {
  if (event && event.target !== document.getElementById('contact-overlay')) return;
  document.getElementById('contact-overlay').classList.add('hidden');
}

function toggleShowAllCalls() {
  showAllCalls = !showAllCalls;
  const items = sortItems(calls.map(buildItemModel));
  renderList(items);
}

