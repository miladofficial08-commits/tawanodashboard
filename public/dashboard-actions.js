function renderList(items) {
  const list = document.getElementById('call-list');
  const moreBtn = document.getElementById('more-calls-btn');
  const itemMs = (item) => new Date(item.createdAt || 0).getTime();
  const inRange = item => inSelectedPeriod(item.createdAt);
  // "Alle" zeigt jeden Anruf (egal welcher Typ); die uebrigen Tabs filtern nach Typ.
  // Sortierung IMMER chronologisch nach Anrufzeit (per Auswahl neueste/aelteste zuerst).
  const filtered = items
    .filter((item) => activeFilter === 'all' || activeFilter === item.info.key || (activeFilter === 'callback' && item.info.key === 'problem'))
    .filter(inRange)
    .sort((a, b) => (sortOrder === 'old' ? itemMs(a) - itemMs(b) : itemMs(b) - itemMs(a)));
  const visibleItems = showAllCalls ? filtered : filtered.slice(0, DEFAULT_VISIBLE_CALLS);

  if (!filtered.length) {
    list.innerHTML = '<div class="empty">Keine passenden Anrufe.</div>';
    if (moreBtn) moreBtn.classList.add('hidden');
    return;
  }

  if (moreBtn) {
    if (filtered.length <= DEFAULT_VISIBLE_CALLS) {
      moreBtn.classList.add('hidden');
    } else {
      moreBtn.classList.remove('hidden');
      moreBtn.textContent = showAllCalls ? 'Weniger anzeigen' : ('Mehr Anrufe zeigen (' + (filtered.length - DEFAULT_VISIBLE_CALLS) + ')');
    }
  }

  list.innerHTML = visibleItems.map((item) => {
    const callIdx = calls.indexOf(item.call);
    const hasPhone = Boolean(item.phone);
    const isDone = item.info.key === 'done';
    return '<div class="row" data-call="' + escHtml(item.key) + '" onclick="openDetail(' + callIdx + ')" role="button" tabindex="0">'
      + '<div class="task-main">'
        + '<div class="task-head">'
          + '<span class="priority ' + escHtml(item.priority.className) + '">' + escHtml(item.priority.label) + '</span>'
          + '<span class="badge ' + escHtml(item.info.badge) + '">' + escHtml(item.info.label) + '</span>'
        + '</div>'
        + '<div class="work-customer">' + escHtml(item.customer) + '</div>'
        + briefHtml(item.call, item.info)
        + '<div class="task-footer"><div class="next"><small>' + escHtml(fmtTime(item.createdAt)) + '</small></div></div>'
        + '<div class="task-actions">'
          + '<button class="btn-mini primary" ' + (hasPhone ? '' : 'disabled ') + 'onclick="event.stopPropagation(); contactCustomer(\'call\',' + callIdx + ')">Anrufen</button>'
          + '<button class="btn-mini" ' + (hasPhone ? '' : 'disabled ') + 'onclick="event.stopPropagation(); contactCustomer(\'whatsapp\',' + callIdx + ')">WhatsApp</button>'
          + '<button class="btn-mini" onclick="event.stopPropagation(); forwardTask(' + callIdx + ')">Weiterleiten</button>'
          + (isDone
            ? '<span class="work-done">Erledigt</span>'
            : '<button class="btn-mini done finish-pill" onclick="event.stopPropagation(); markTaskDone(' + callIdx + ')"> Anruf fertig</button>')
        + '</div>'
      + '</div>'
      + '</div>';
  }).join('');
}

function contactCustomer(kind, callIdx) {
  if (previewMode) { alert('Vorschau: Hier würdest du den Kunden kontaktieren.'); return; }
  const call = calls[callIdx];
  if (!call) return;
  const phone = customerPhone(call);
  if (!phone) return;
  if (kind === 'call') {
    window.open('tel:' + phone, '_self');
    return;
  }
  if (kind === 'whatsapp') {
    window.open('https://wa.me/' + whatsappNumber(phone), '_blank');
  }
}
function forwardTask(callIdx) {
  if (previewMode) { alert('Vorschau: Hier würdest du das Anliegen weitergeben.'); return; }
  const call = calls[callIdx];
  if (!call) return;
  const info = classifyCall(call);
  const note = customerLabel(call) + ' | ' + summaryFor(call) + ' | Nächster Schritt: ' + nextStepForCall(call, info);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(note).then(() => setStatus('ok', 'Notiz zum Weiterleiten kopiert')).catch(() => {});
  }
  openDetail(callIdx);
}
// Ohne Rueckmeldung verschwand die Karte einfach - es war nicht zu erkennen, ob
// gespeichert wurde. Jetzt: Haken auf der Karte, dann ausblenden, dann Hinweis.
function callCardNodes(key) {
  return Array.from(document.querySelectorAll('[data-call]')).filter((node) => node.getAttribute('data-call') === key);
}
function flashDone(key) {
  const nodes = callCardNodes(key);
  nodes.forEach((node) => node.classList.add('is-done-flash'));
  if (!nodes.length) return Promise.resolve();
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return new Promise((resolve) => setTimeout(resolve, reduced ? 220 : 700));
}
function clearDoneFlash(key) {
  callCardNodes(key).forEach((node) => node.classList.remove('is-done-flash'));
}
async function markTaskDone(callIdx) {
  const call = calls[callIdx];
  if (!call) return;
  const key = callKey(call);
  const shown = flashDone(key);
  try { await saveWork(callIdx,{state:'done'},undefined,{defer:true}); }
  catch(e) { clearDoneFlash(key); alert(e.message); return; }
  await shown;
  render();
  setStatus('ok', previewMode ? 'Vorschau geändert' : 'Gespeichert');
  toast('Erledigt · zu finden im Reiter „Erledigt“');
}

async function openDetail(callIdx) {
  const call = calls[callIdx];
  if (!call) return;
  detailCallId = callKey(call);
  detailWorkVersion = call.work?.updated_at || null;
  const info = classifyCall(call);
  let phone = customerPhone(call);
  if (!previewMode && !phone && call.provider === 'elevenlabs' && call.call_id) {
    try {
      const result = await fetchApi('/api/call-detail', { method:'POST', headers:authHeaders(), body:JSON.stringify({call_id:call.call_id}) });
      if (result.res.ok && result.data.ok) {
        const detail = result.data.call;
        call.phoneNumber = detail.from_number;
        call.from_number = detail.from_number;
        call.summary = detail.summary || call.summary;
        phone = customerPhone(call);
        render();
      }
    } catch (_) { /* Details remain readable without a phone number. */ }
  }

  const customerName = String(call.customerName || call.name || '').trim();
  if (detailCallId !== callKey(call)) return;
  const summaryBlock = detailSummarySource(call);

  document.getElementById('detail-title').textContent = customerName || (phone ? 'Anrufer ' + phone : 'Anruf-Details');
  const subEl = document.getElementById('detail-sub');
  if (subEl) subEl.textContent = fmtTime(call.createdAt) + ' · ' + info.label;

  const renderFrom = (text) => {
    const model = buildDetailModel(call, text);
    document.getElementById('detail-body').innerHTML = detailHtml(call, info, model, phone) + workEditorHtml(call);
  };
  renderFrom(summaryBlock);
  document.getElementById('call-detail-overlay').classList.remove('hidden');

  // Detail-Analyse: volles Transkript + Aufnahme (nur wenn fuer diesen Kunden aktiviert, z. B. Tawano).
  if (!previewMode && currentTenant && currentTenant.detailed_analysis && call.call_id) {
    const bodyEl = document.getElementById('detail-body');
    if (bodyEl) {
      const sec = document.createElement('div');
      sec.className = 'detail-section';
      sec.innerHTML = '<em> Vollständiges Gespräch</em><div id="transcript-body" class="empty">Transkript wird geladen...</div>';
      bodyEl.appendChild(sec);
      loadCallTranscript(call.call_id);
    }
  }
}

async function loadCallTranscript(callId) {
  const el = document.getElementById('transcript-body');
  if (!el) return;
  try {
    const res = await fetch(serverUrl() + '/api/call-detail', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ call_id: callId }) });
    const data = await res.json();
    if (!res.ok || !data.ok) { el.textContent = 'Transkript nicht verfügbar.'; return; }
    const c = data.call || {};
    let html = '';
    const chips = [];
    if (c.call_successful !== null && c.call_successful !== undefined) chips.push('<span class="chip-mood ' + (c.call_successful ? 'pos' : 'neg') + '">' + (c.call_successful ? 'Erfolgreich' : 'Nicht erfolgreich') + '</span>');
    if (c.in_voicemail) chips.push('<span class="chip-mood neu">Mailbox</span>');
    if (c.duration_ms) chips.push('<span class="chip-topic">Dauer ' + Math.round(c.duration_ms / 1000) + ' Sek</span>');
    if (chips.length) html += '<div class="detail-chips" style="margin-bottom:10px">' + chips.join('') + '</div>';
    if (c.recording_url) html += '<audio class="transcript-audio" controls src="' + escHtml(c.recording_url) + '"></audio>';
    if (Array.isArray(c.transcript_object) && c.transcript_object.length) {
      html += '<div class="transcript">' + c.transcript_object.map((t) => {
        const isAgent = String(t.role || '') === 'agent';
        return '<div class="tr ' + (isAgent ? 'tr-agent' : 'tr-user') + '"><strong>' + (isAgent ? 'Agent' : 'Anrufer') + '</strong>' + escHtml(t.content || '') + '</div>';
      }).join('') + '</div>';
    } else if (c.transcript) {
      html += '<div class="transcript"><div class="tr tr-agent">' + escHtml(c.transcript).replace(/\n/g, '<br>') + '</div></div>';
    } else {
      html += '<div class="empty">Kein Transkript vorhanden.</div>';
    }
    el.className = '';
    el.innerHTML = html;
  } catch (e) {
    el.textContent = 'Transkript nicht verfügbar.';
  }
}

function closeDetail(event) {
  if (event && event.target !== document.getElementById('call-detail-overlay')) return;
  detailCallId = null;
  document.getElementById('call-detail-overlay').classList.add('hidden');
}

document.getElementById('call-list').addEventListener('keydown', event => {
  if (event.target.classList.contains('row') && ['Enter', ' '].includes(event.key)) { event.preventDefault(); event.target.click(); }
});
document.addEventListener('keydown', event => { if (event.key === 'Escape') { closeDetail(); closeContact(); } });
if (previewMode) {
  calls = previewCalls();
  currentTenant = demoMode ? DEMO_TENANT : { id:'preview-handwerk', name:'Bergmann Haustechnik', provider:'elevenlabs', detailed_analysis:true };
  const banner = document.getElementById('preview-banner');
  banner.classList.remove('hidden');
  if (demoMode) banner.innerHTML = 'Beispiel-Dashboard · alle Anrufe, Namen und Bewertungen sind erfunden. Es werden keine echten Daten geladen oder gespeichert.';
  showDashboard(); render(); setStatus('ok', demoMode ? 'Beispiel-Dashboard' : 'Beispieldaten');
} else if (authToken) {
  showDashboard();
  refreshCalls();
} else {
  showLogin();
}

// Auto-Refresh laeuft NUR, wenn eingeloggt UND der Tab sichtbar ist.
// Vorher lief der Timer dauerhaft weiter (auch im Hintergrund-Tab und ohne Login)
// und hat das Netlify-Function-Kontingent aufgebraucht -> Site ging mit 503
// "usage_exceeded" offline und die SMS-Tools im Anruf schlugen fehl.
function syncRefreshTimer() {
  const shouldRun = !previewMode && Boolean(authToken) && !document.hidden;
  if (shouldRun && !timer) {
    timer = setInterval(refreshCalls, 15000);
  } else if (!shouldRun && timer) {
    clearInterval(timer);
    timer = null;
  }
}

document.addEventListener('visibilitychange', () => {
  // Beim Zurueckkehren sofort aktualisieren, damit sich nichts "eingefroren" anfuehlt.
  if (!document.hidden && authToken) refreshCalls();
  syncRefreshTimer();
});

syncRefreshTimer();
