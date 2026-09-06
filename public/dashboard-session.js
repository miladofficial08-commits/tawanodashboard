
const LIVE_SERVER_URL = 'https://tawanodashboard.netlify.app';

let calls = [];
let callbackRequests = []; // Rueckrufauftraege, die der Telefonassistent selbst angelegt hat
let authToken = '';
let currentUser = null;
// Admin-Ansicht ("Dashboard oeffnen") laeuft pro Tab ueber sessionStorage -> ueberschreibt NIE
// den echten Kunden-Login und vermischt keine Daten zwischen Tabs.
(function initAuthSession() {
  try {
    const h = new URLSearchParams((location.hash || '').replace(/^#/, ''));
    const impTok = h.get('admin_token');
    if (impTok) {
      authToken = impTok;
      currentUser = { email: h.get('admin_email') || 'Kunde (Admin-Ansicht)' };
      sessionStorage.setItem('tawano_imp_token', impTok);
      sessionStorage.setItem('tawano_imp_user', JSON.stringify(currentUser));
      if (history.replaceState) history.replaceState(null, '', location.pathname);
      return;
    }
    const st = sessionStorage.getItem('tawano_imp_token');
    if (st) { authToken = st; currentUser = JSON.parse(sessionStorage.getItem('tawano_imp_user') || 'null'); return; }
    authToken = localStorage.getItem('tawano_access_token') || '';
    currentUser = JSON.parse(localStorage.getItem('tawano_user') || 'null');
  } catch (_) {
    authToken = localStorage.getItem('tawano_access_token') || '';
  }
})();
let currentTenant = null;
let timer = null;
let activeFilter = 'all';
let sortOrder = 'new';   // 'new' = neueste zuerst, 'old' = älteste zuerst
let timeRange = 'all';   // 'all' | 'today' | 'week'
let showAllCalls = false;
const DEFAULT_VISIBLE_CALLS = 5;

function callTimeMs(call) {
  const t = new Date(call && (call.createdAt || call.updatedAt) || 0).getTime();
  return Number.isFinite(t) ? t : 0;
}
function callDurationMin(call) {
  return (Number(call && call.durationMs) || 0) / 60000;
}
// Nur echte, verbundene Gespräche zählen als genutzte Minuten (Fehler/nicht verbunden = 0)
function callBillableMin(call) {
  const status = String(call && (call.status || call.retellStatus) || '').toLowerCase();
  if (!['ended', 'ongoing', 'in-progress'].includes(status)) return 0;
  return callDurationMin(call);
}
function defaultServerUrl() {
  // Das Dashboard wird IMMER vom selben Server ausgeliefert, der auch die API bereitstellt
  // (Netlify, Railway, lokal) -> die eigene Herkunft ist die richtige API-Basis.
  // Vorher war hier eine Netlify-Domain fest verdrahtet: auf jedem anderen Host (z. B. Railway)
  // gingen dadurch ALLE API-Aufrufe an Netlify statt an den eigenen Server -> "Offline".
  if (location.protocol === 'http:' || location.protocol === 'https:') return location.origin;
  // Nur beim Oeffnen als lokale Datei (file://) gibt es keine brauchbare Herkunft.
  return LIVE_SERVER_URL;
}
function providerSummaryText(call) {
  const analysis = call.callAnalysis || call.call_analysis || {};
  const custom = analysis.custom_analysis_data || {};
  return String(custom.summary || analysis.call_summary || analysis.summary || call.summary || '').trim();
}
// Im Dashboard steht ausschliesslich Deutsch. Englische Anbietertexte werden in
// einen deutschen Satz umgeschrieben (public/german.js); das Original bleibt im
// Detail unter "Originaltext des Anbieters" nachlesbar.
function germanSummaryOf(call) {
  return memoOnCall(call, '_german', textStamp(call), () => {
    const raw = providerSummaryText(call);
    if (typeof German === 'undefined') return { text: raw, translated: false, original: '' };
    return German.germanSummary(raw);
  });
}
function detailSummarySource(call) {
  return germanSummaryOf(call).text;
}
// Anbieter liefern teils Schluessel (user_hangup), teils englischen Fliesstext
// ("call ended by remote party"). Der Handwerker soll nie englischen Rohtext lesen -
// darum erst die bekannten Schluessel, dann Stichwoerter, sonst ein neutraler Satz.
const DISCONNECT_LABELS = {
  user_hangup: 'Anrufer hat aufgelegt',
  agent_hangup: 'Assistent hat aufgelegt',
  call_transfer: 'Weiterleitung',
  voicemail_reached: 'Mailbox erreicht',
  dial_no_answer: 'Keine Antwort',
  dial_busy: 'Besetzt',
  dial_failed: 'Anruf fehlgeschlagen',
  inactivity: 'Gespräch ohne Reaktion beendet',
  max_duration_reached: 'Maximaldauer erreicht',
};
const DISCONNECT_HINTS = [
  [/remote party|caller|anrufer|user hung|user hang/, 'Anrufer hat aufgelegt'],
  [/agent|assistant|assistent/, 'Assistent hat aufgelegt'],
  [/transfer|weitergeleitet/, 'Weiterleitung'],
  [/voicemail|mailbox/, 'Mailbox erreicht'],
  [/no answer|unanswered|keine antwort/, 'Keine Antwort'],
  [/busy|besetzt/, 'Besetzt'],
  [/inactiv|timeout|silence/, 'Gespräch ohne Reaktion beendet'],
  [/max.?duration/, 'Maximaldauer erreicht'],
  [/error|failed|fehler/, 'Technisch beendet'],
];
function mapDisconnectionReason(reasonRaw) {
  const reason = String(reasonRaw || '').trim().toLowerCase();
  if (!reason) return '-';
  if (DISCONNECT_LABELS[reason]) return DISCONNECT_LABELS[reason];
  const hint = DISCONNECT_HINTS.find(([pattern]) => pattern.test(reason));
  if (hint) return hint[1];
  return /[a-z]{3,}\s[a-z]{3,}/.test(reason) ? 'Gespräch beendet' : reason.replace(/_/g, ' ');
}
// Ergebnisse je Gespraech zwischenspeichern: Einstufung und Rueckrufzeit werden beim
// Rendern mehrfach gebraucht, und die Liste kann seit der vollstaendigen Historie
// tausende Gespraeche enthalten. Der Stempel macht den Cache bei jeder Aenderung
// ungueltig; `calls` wird beim Aktualisieren ohnehin komplett ersetzt.
function workStamp(call) {
  const work = call.work || {};
  return [work.state || '', work.state_manual ? 1 : 0, work.schedule_manual ? 1 : 0, work.scheduled_at || '', work.updated_at || ''].join('|');
}
function memoOnCall(call, slot, stamp, compute) {
  if (call && call[slot] && call[slot].stamp === stamp) return call[slot].value;
  const value = compute();
  if (call) {
    try { Object.defineProperty(call, slot, { value: { stamp, value }, configurable: true, writable: true, enumerable: false }); }
    catch (_) { /* eingefrorene Objekte laufen ohne Cache weiter */ }
  }
  return value;
}
// Kurze Rueckmeldung fuer Aktionen, die sonst nur "verschwinden" (erledigt, geplant).
let toastTimer = null;
function toast(text, kind) {
  const el = document.getElementById('toast');
  if (!el) { setStatus('ok', text); return; }
  el.textContent = text;
  el.className = 'toast ' + (kind || 'ok');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3200);
}
function extractFieldByLabels(text, labels) {
  const source = String(text || '');
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('(?:^|\\n)\\s*' + escaped + '\\s*:\\s*([^\\n]+)', 'i');
    const m = source.match(re);
    if (m && m[1]) return m[1].trim();
  }
  return '';
}
function extractDetailLines(text) {
  const lines = String(text || '').split(/\r?\n/);
  const out = [];
  let inDetails = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = String(lines[i] || '').trim();
    if (!line) continue;
    const lower = line.toLowerCase();
    if (lower.startsWith('details:') || lower.startsWith('detail:') || lower.startsWith('stichpunkte:') || lower.startsWith('notiz:') || lower.startsWith('notizen:')) {
      inDetails = true;
      const rest = line.slice(line.indexOf(':') + 1).trim();
      if (rest) out.push(rest);
      continue;
    }
    if (!inDetails) continue;
    const stops = ['erledigt:', 'nächster schritt:', 'naechster schritt:', 'next step:', 'stimmung:', 'sentiment:'];
    if (stops.some((item) => lower.startsWith(item))) break;
    const cleaned = line.replace(/^[-*•]\s*/, '').trim();
    if (cleaned) out.push(cleaned);
  }
  return out;
}
function callbackInstructionFromText(text) {
  const sentences = String(text || '').split(/(?<=[.!?])\s+|[\n|]/);
  for (const sentence of sentences) {
    if (!/rückruf|rueckruf|zurückruf|zurueckruf|erreichbar|callback|call back/i.test(sentence)) continue;
    const time = sentence.match(/(?:(?:heute|morgen|übermorgen|uebermorgen|am\s+(?:Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag|\d{1,2}\.\d{1,2}\.?))\s+)?(?:ab|um|zwischen|von)\s+\d{1,2}(?:[:.]\d{2})?(?:\s*(?:und|bis|–|-)\s*\d{1,2}(?:[:.]\d{2})?)?\s*(?:Uhr|h)?/i);
    if (time) return 'Rückruf: ' + time[0].trim();
    if (/dringend|schnellstmöglich|so schnell wie möglich/i.test(sentence)) return 'Rückruf ausdrücklich dringend gewünscht';
  }
  return '';
}
function nextStepForCall(call, info) {
  const summaryBlock = detailSummarySource(call);
  const parsedNext = extractFieldByLabels(summaryBlock, ['nächster schritt', 'naechster schritt', 'next step']);
  const callbackText = callbackInstructionFromText([parsedNext, summaryBlock, summaryFor(call)].join(' | '));
  if (callbackText) return callbackText;
  if (parsedNext) return parsedNext;
  return info.next;
}
// Zerlegt eine einzeilige Emoji-Zusammenfassung in saubere, beschriftete Zeilen
function normalizeSummary(block) {
  let s = String(block || '');
  // Emoji-Abschnittsmarker -> Zeilenumbruch
  s = s.replace(/\s*(?:\p{Extended_Pictographic}|✔)\uFE0F?\s*/gu, '\n');
  // Bekannte Labels immer an Zeilenanfang setzen
  s = s.replace(/\s*(Anliegen|Details?|Erledigt|N(?:ä|ae)chster Schritt|Stimmung|Sentiment|Next Step|Done|Grund|Anfrage)\s*:/gi, '\n$1:');
  // Kopfzeile "Gesprächsübersicht" entfernen
  s = s.replace(/gespr(?:ä|ae)chs(?:ü|ue)bersicht/ig, ' ');
  return s.replace(/[ \t]+\n/g, '\n').replace(/\n{2,}/g, '\n').trim();
}
// Entfernt führende Emojis/Sonderzeichen und Rausch-Wörter
function cleanFactText(text) {
  let s = String(text || '').replace(/^[^\p{L}\p{N}+]+/u, '').trim();
  s = s.replace(/[\s\-–•|]+$/u, '').trim();
  return s;
}
// Baut ein sauberes, dedupliziertes Detail-Modell für die Modal-Ansicht
function buildDetailModel(call, sourceText) {
  const analysis = call.callAnalysis || call.call_analysis || {};
  const custom = analysis.custom_analysis_data || {};
  const block = String(sourceText != null ? sourceText : detailSummarySource(call) || '').trim();
  const norm = normalizeSummary(block);

  // Anliegen (Hauptgrund)
  let anliegen = cleanFactText(extractFieldByLabels(norm, ['anliegen', 'intent', 'grund', 'anfrage'])
    || String(custom.intent || custom.reason || call.intent || call.reason || '').trim());
  if (!anliegen) anliegen = summaryFor(call);

  // Details als Stichpunkte
  let details = extractDetailLines(norm);
  if (details.length <= 1) {
    const dMatch = norm.match(/(?:^|\n)\s*details?\s*:\s*([^\n]*)/i);
    if (dMatch && /[-•*]/.test(dMatch[1])) details = dMatch[1].split(/\s*[-•*]\s+|\r?\n/);
  }
  const aLow = anliegen.toLowerCase();
  const seen = new Set();
  details = details
    .map((d) => cleanFactText(String(d || '').replace(/^[-*•]\s*/, '')))
    .filter(Boolean)
    .filter((d) => {
      const low = d.toLowerCase();
      if (low === 'details' || low === 'detail' || low.length < 3) return false;
      // Nur wegfiltern, wenn das Anliegen kurz ist (sonst gehen echte Details verloren)
      if (aLow && (aLow === low || (aLow.length < 140 && aLow.includes(low)))) return false;
      if (seen.has(low)) return false;
      seen.add(low);
      return true;
    });

  const naechster = cleanFactText(extractFieldByLabels(norm, ['nächster schritt', 'naechster schritt', 'next step']));
  const erledigt = cleanFactText(extractFieldByLabels(norm, ['erledigt', 'done']));
  let stimmung = cleanFactText(extractFieldByLabels(norm, ['stimmung', 'sentiment'])) || String(analysis.user_sentiment || call.sentiment || '').trim();
  const sMap = { positive: 'Positiv', negative: 'Negativ', neutral: 'Neutral' };
  if (stimmung) stimmung = sMap[stimmung.toLowerCase()] || stimmung;
  const beendigung = mapDisconnectionReason(call.disconnectionReason || call.disconnection_reason);
  const original = germanSummaryOf(call).original;
  const rueckruf = callbackInstructionFromText([naechster, norm, summaryFor(call)].join(' | '));

  return { anliegen, details, naechster, erledigt, stimmung, beendigung, rueckruf, original };
}
// Erzeugt das HTML für den Detail-Modal aus dem Modell
function detailHtml(call, info, m, phone) {
  const parts = [];

  // Chips ganz oben: Status · Thema · Stimmung (sofort erkennbar)
  const thema = topicFromCall(call);
  const moodCls = m.stimmung ? (/(positiv|positive)/i.test(m.stimmung) ? 'pos' : (/(negativ|negative)/i.test(m.stimmung) ? 'neg' : 'neu')) : '';
  let chips = '<span class="badge ' + escHtml(info.badge) + '">' + escHtml(info.label) + '</span>';
  if (thema && thema !== 'Sonstiges') chips += '<span class="chip-topic">' + escHtml(thema) + '</span>';
  if (m.stimmung) chips += '<span class="chip-mood ' + moodCls + '">' + escHtml(m.stimmung) + '</span>';
  parts.push('<div class="detail-chips">' + chips + '</div>');

  // Anliegen (Hauptsache, groß)
  parts.push('<div class="detail-hero"><em> Anliegen</em><p>' + escHtml(m.anliegen || 'Kein konkretes Anliegen erkannt.') + '</p></div>');

  // Was jetzt zu tun ist – direkt nach dem Anliegen
  if (m.naechster) {
    parts.push('<div class="detail-action"><em> Nächster Schritt</em><p>' + escHtml(m.naechster) + '</p></div>');
  }
  if (m.rueckruf) {
    parts.push('<div class="detail-callback"><em> Rückrufwunsch im Gespräch</em><p>' + escHtml(m.rueckruf) + '</p></div>');
  }
  // Was bereits passiert ist
  if (m.erledigt) {
    parts.push('<div class="detail-done"><em> Erledigt</em><p>' + escHtml(m.erledigt) + '</p></div>');
  }
  // Alle Detail-Stichpunkte
  if (m.details.length) {
    parts.push('<div class="detail-section"><em> Wichtigste Details</em><div class="detail-bullets">'
      + m.details.map((d) => '<div>' + escHtml(d) + '</div>').join('') + '</div></div>');
  }

  // Kompakte Fakten unten
  const meta = [];
  const durMin = callDurationMin(call);
  if (durMin > 0) meta.push('<div><em>Dauer</em><b>' + (durMin >= 1 ? durMin.toFixed(1) + ' Min' : Math.round(durMin * 60) + ' Sek') + '</b></div>');
  meta.push('<div><em>Gesprächsende</em><b>' + escHtml(m.beendigung) + '</b></div>');
  if (phone) meta.push('<div><em>Telefon</em><b>' + escHtml(phone) + '</b></div>');
  meta.push('<div><em>Zeitpunkt</em><b>' + escHtml(fmtTime(call.createdAt)) + '</b></div>');
  parts.push('<div class="detail-meta">' + meta.join('') + '</div>');
  // Der Anbieter hat englisch zusammengefasst: oben steht die deutsche Fassung,
  // hier bleibt der Originaltext einsehbar - damit nichts verloren geht.
  if (m.original) {
    parts.push('<details class="detail-original"><summary>Originaltext des Telefonanbieters (Englisch)</summary><p>' + escHtml(m.original) + '</p></details>');
  }
  return parts.join('');
}
