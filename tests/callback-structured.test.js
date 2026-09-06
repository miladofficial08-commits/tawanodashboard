const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {callbackFields} = require('../netlify/functions/_lib/callback-fields');
const time = require('../public/planner-time');

const created = '2026-09-06T13:00:00Z';

// 1) Anbieter-Felder einsammeln: Retell (Post Call Analysis) und ElevenLabs (Data Collection).
assert.deepEqual(callbackFields({callback_date: '2026-09-08', callback_time: '16:00'}), {date: '2026-09-08', time: '16:00'});
assert.deepEqual(callbackFields({'Rückruf Datum': '08.09.2026'}), {date: '08.09.2026'});
assert.deepEqual(callbackFields({callback_at: {value: '2026-09-08T16:00:00+02:00', rationale: 'x'}}), {at: '2026-09-08T16:00:00+02:00'});
assert.deepEqual(callbackFields([{data_collection_id: 'callback_time', value: '16:00'}]), {time: '16:00'});
assert.equal(callbackFields({summary: 'Rückruf gewünscht'}), null, 'Freitextfelder sind keine Zeitangabe');
assert.equal(callbackFields(null, undefined, 'text'), null);

// 2) Strukturierte Angabe -> geprueste Zeit in Europe/Berlin.
assert.equal(time.fromStructured({date: '2026-09-08', time: '16:00'}, created).iso, '2026-09-08T14:00:00.000Z');
assert.equal(time.fromStructured({at: '2026-09-08T16:00:00+02:00'}, created).iso, '2026-09-08T14:00:00.000Z');
assert.equal(time.fromStructured({at: '2026-09-08 16:00'}, created).iso, '2026-09-08T14:00:00.000Z', 'ohne Zeitzone gilt Europe/Berlin');
assert.equal(time.fromStructured({date: '08.09.', time: '16 Uhr', end: '18:00'}, created).end, '18:00');
assert.equal(time.fromStructured({date: 'morgen'}, created).day, '2026-09-07');
assert.equal(time.fromStructured({date: '2026-09-08', time: '26:00'}, created).iso, null, 'unmoegliche Uhrzeit bleibt offen');
assert.equal(time.fromStructured({date: '2026-10-25', time: '02:30'}, created).iso, null, 'mehrdeutige Zeitumstellung bleibt offen');
assert.equal(time.fromStructured({date: 'unbekannt'}, created), null);
assert.equal(time.fromStructured({date: '2026-09-08', time: '16:00', wanted: 'nein'}, created), null, 'kein Rueckruf gewuenscht');
assert.equal(time.fromStructured(null, created), null);

// 3) Rangfolge im Rueckrufplan: eigene Eingabe > strukturierte Angabe > Freitext.
const source = fs.readFileSync(require.resolve('../public/dashboard-planner.js'), 'utf8').split('function plannerEntries')[0];
const ctx = {
  callbackRequests: [],
  callKey: (call) => call.call_id,
  detailSummarySource: (call) => call.summary || '',
  console,
};
const session = fs.readFileSync(require.resolve('../public/dashboard-session.js'), 'utf8');
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(require.resolve('../public/planner-time.js'), 'utf8'), ctx);
vm.runInContext(session.slice(session.indexOf('function workStamp('), session.indexOf('// Kurze Rueckmeldung')), ctx);
vm.runInContext(source, ctx);

const base = {call_id: 'c1', createdAt: created};
assert.equal(ctx.scheduleFor({...base, summary: 'Rückruf morgen um 16 Uhr.'}).iso, '2026-09-07T14:00:00.000Z', 'Freitext bleibt der Rueckfall');
assert.equal(ctx.scheduleFor({...base, summary: 'Rückruf morgen um 16 Uhr.', callback: {date: '2026-09-09', time: '09:00'}}).iso, '2026-09-09T07:00:00.000Z', 'strukturierte Angabe schlaegt Freitext');
ctx.callbackRequests = [{call_id: 'c1', callback_at: '2026-09-10T08:00:00+02:00'}];
assert.equal(ctx.scheduleFor({...base, summary: 'Rückruf morgen um 16 Uhr.'}).iso, '2026-09-10T06:00:00.000Z', 'Rueckrufauftrag des Assistenten wird uebernommen');
assert.equal(ctx.scheduleFor({...base, summary: 'Rückruf morgen um 16 Uhr.', work: {schedule_manual: true, scheduled_at: '2026-09-11T10:00:00Z'}}).label, 'Von dir geplant');
assert.equal(ctx.scheduleFor({call_id: 'other', createdAt: created, summary: 'Kein Termin genannt.'}).iso, null, 'ohne Angabe wird nichts erfunden');

console.log('Structured callback times passed');
