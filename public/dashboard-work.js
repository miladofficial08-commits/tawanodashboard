function shortFact(value, max = 100) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return text.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
}

function callBrief(call) {
  const source = detailSummarySource(call);
  const normalized = normalizeSummary(source);
  const explicit = extractFieldByLabels(normalized, ['Anliegen', 'Anfrage', 'Grund']);
  const sentences = normalized.split(/(?<=[.!?])\s+|\n/).map(s => s.replace(/^[-•*]\s*/, '').trim()).filter(Boolean);
  const chosen = explicit || sentences.find(s => !/^(Details|Stimmung|Erledigt|Nächster Schritt):/i.test(s)) || '';
  // Ohne Anbieter-Text lieber sagen, was bekannt ist (Dauer, Abbruchgrund),
  // statt "Anliegen noch nicht verfügbar" stehen zu lassen.
  const headline = (chosen || summaryFor(call))
    .replace(/^Anliegen:\s*/i, '').replace(/^Rückruf gewünscht:\s*/i, '').replace(/[.!]$/, '');
  let details = sentences.filter(s => s !== chosen && !headline.includes(s.replace(/[.!]$/, '')) && !/^(Name|Stimmung|Erledigt|Nächster Schritt|Anliegen):/i.test(s));
  if (explicit) {
    const address = extractFieldByLabels(source, ['Einsatzort', 'Adresse']);
    const time = extractFieldByLabels(source, ['Terminwunsch', 'Zeitangabe']);
    const urgency = extractFieldByLabels(source, ['Dringlichkeit']);
    const urgent = /elektrische Gefahr|sofort/i.test(urgency);
    const second = urgent ? 'Dringlichkeit: ' + urgency : time ? 'Zeitangabe: ' + time : urgency && 'Dringlichkeit: ' + urgency;
    const keyFacts = [address && 'Einsatzort: ' + address, second].filter(Boolean);
    if (keyFacts.length) details = keyFacts;
  }
  const info = classifyCall(call);
  const manual = call.work?.schedule_manual;
  const planned = manual && call.work.scheduled_at;
  const time = info.key === 'done' ? '' : manual
    ? (planned ? 'Geplant: '+PlannerTime.dateKey(planned).split('-').reverse().join('.')+' um '+PlannerTime.clock(planned)+' Uhr' : 'Rückrufzeit noch offen')
    : callbackInstructionFromText(source);
  return {
    title: shortFact(headline, 105),
    facts: details.slice(0, 2).map(s => shortFact(s, 130)),
    next: shortFact(info.key === 'done' ? info.next : extractFieldByLabels(source, ['Nächster Schritt']) || (time ? info.next : nextStepForCall(call, info)), 110),
    time,
  };
}

function briefHtml(call, info) {
  const brief = callBrief(call);
  return '<div class="call-brief"><h3>' + escHtml(brief.title) + '</h3>'
    + (brief.facts.length ? '<ul>' + brief.facts.map(f => '<li>' + escHtml(f) + '</li>').join('') + '</ul>' : '')
    + '<div class="brief-next' + (info.key === 'done' ? ' completed' : '') + '"><span>DEIN NÄCHSTER SCHRITT</span><strong>' + escHtml(brief.next) + '</strong></div>'
    + (brief.time ? '<p class="brief-time"><strong>' + escHtml(brief.time) + '</strong><span>' + (call.work?.schedule_manual ? 'Von dir festgelegt' : 'Zeitangabe aus dem Gespräch vom ' + escHtml(fmtTime(call.createdAt))) + '</span></p>' : '')
    + '</div>';
}
