const assert = require('node:assert/strict');
const tenant = require('../netlify/functions/_lib/tenant');

let syncStateMissing = false;
let savedState = null;
tenant.listRows = async (table) => {
  if (table === 'call_workspace') return [{started_at: '2026-09-05T10:00:00Z'}];
  if (table === 'call_sync_state') {
    if (syncStateMissing) { const error = new Error('missing'); error.data = {code: 'PGRST205'}; throw error; }
    return [{synced_from: '2026-08-01T00:00:00Z', history_complete: false}];
  }
  return [];
};
tenant.supabaseRequest = async (path, opts) => {
  if (path.indexOf('call_sync_state') !== -1) savedState = opts.body;
  return {response: {ok: true}};
};

const {collectHistory, loadHistoryState, saveHistoryState} = require('../netlify/functions/_lib/call-history');

// Erzeugt Seiten mit je `size` Gespraechen, absteigend ab `startMs` im Minutentakt.
function pager(size, pages, options) {
  const opts = options || {};
  let served = 0;
  const calls = [];
  return async () => {
    const page = [];
    for (let index = 0; index < size; index += 1) {
      const at = new Date((opts.startMs || Date.parse('2026-09-06T12:00:00Z')) - served * 60000).toISOString();
      page.push({call_id: 'c' + served, createdAt: at});
      served += 1;
    }
    calls.push(...page);
    return {calls: page, cursor: served < size * pages ? 'cursor-' + served : '', supportsBefore: Boolean(opts.supportsBefore)};
  };
}

(async () => {
  // 1) Vollstaendige Historie: es wird nur bis zum letzten gespeicherten Anruf geblaettert.
  let requests = 0;
  const known = Date.parse('2026-09-06T09:00:00Z'); // 180 Minuten vor der neuesten Seite
  const next = pager(100, 10);
  const result = await collectHistory(async (page) => { requests += 1; return next(page); }, {
    lastCallAtMs: known, complete: true,
  });
  assert.equal(requests, 2, 'zwei Seiten reichen bis zum bekannten Stand');
  assert.equal(result.calls.length, 200, 'deutlich mehr als die frueheren 120 Gespraeche');
  assert.equal(result.complete, true);

  // 2) Erstsynchronisierung: es wird bis zum Go-Live zurueckgeblaettert.
  const cutoff = Date.parse('2026-09-06T08:00:00Z'); // 240 Minuten zurueck
  const initial = await collectHistory(pager(100, 10), {cutoffMs: cutoff, complete: false});
  assert.equal(initial.calls.length, 300, 'Historie bis zum Go-Live, nicht nur die erste Seite');
  assert.equal(initial.complete, true);
  assert.equal(initial.syncedFromMs <= cutoff, true, 'Merker steht auf dem aeltesten geholten Gespraech');

  // 3) Sehr grosser Rueckstand: der Abruf bricht sauber ab und meldet offene Nacharbeit.
  const huge = await collectHistory(pager(100, 1000), {cutoffMs: 0, complete: false});
  assert.equal(huge.complete, false, 'offener Rueckstand wird gemeldet');
  assert.ok(huge.calls.length >= 1000 && huge.calls.length <= 1500, 'Budget je Abruf begrenzt');

  // 4) Anbieter meldet "es geht weiter", liefert aber keinen Cursor -> nicht als vollstaendig zaehlen.
  const stuck = await collectHistory(async () => ({calls: [{call_id: 'x', createdAt: '2026-09-06T12:00:00Z'}], cursor: '', more: true}), {complete: false});
  assert.equal(stuck.complete, false);

  // 5) Wiedereinstieg ohne Zeitfilter (Retell): der bekannte Block wird per Versatz
  //    uebersprungen, statt ihn bei jedem Abruf erneut zu lesen.
  const seen = [];
  const paged = pager(100, 50);
  const resumed = await collectHistory(async (page) => { seen.push({cursor: page.cursor, skip: page.skip}); return paged(page); }, {
    lastCallAtMs: Date.parse('2026-09-06T10:30:00Z'), // 90 Minuten zurueck -> mitten auf Seite 1
    syncedFromMs: Date.parse('2026-09-01T00:00:00Z'),
    coveredCount: 300,
    complete: false,
  });
  const jump = seen.find(entry => !entry.cursor && entry.skip > 0);
  assert.ok(jump, 'nach dem bekannten Block wird mit Versatz weitergelesen');
  assert.equal(jump.skip, 200, '300 bekannte Gespraeche minus 100 Ueberlappung');
  assert.equal(resumed.calls.length > 100, true);

  // 6) Gespeicherter Stand wird gelesen; ohne Migration laeuft alles weiter.
  const state = await loadHistoryState({id: 't', provider: 'retell', retell_agent_id: 'a'});
  assert.equal(state.lastCallAtMs, Date.parse('2026-09-05T10:00:00Z'));
  assert.equal(state.syncedFromMs, Date.parse('2026-08-01T00:00:00Z'));
  assert.equal(state.complete, false);
  await saveHistoryState({id: 't', provider: 'retell', retell_agent_id: 'a'}, state, {syncedFromMs: cutoff, complete: true});
  assert.equal(savedState.tenant_id, 't');
  assert.equal(savedState.history_complete, true);

  syncStateMissing = true;
  const fallback = await loadHistoryState({id: 't', provider: 'retell', retell_agent_id: 'a'});
  assert.equal(fallback.tracked, false);
  assert.equal(fallback.complete, true, 'ohne Tabelle nur Neues holen statt zu scheitern');

  console.log('Call history paging and backfill passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
