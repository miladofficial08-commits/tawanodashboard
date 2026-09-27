const assert = require('node:assert/strict');
const german = require('../public/german');

// Deutsche Texte bleiben unangetastet.
for (const text of [
  'Rückruf gewünscht: Die Heizung im Einfamilienhaus bleibt kalt.',
  'Der Kunde hat nach dem Service gefragt und einen Termin vereinbart.',
  'Frau Fischer möchte ein Angebot für die Badsanierung.',
]) {
  const result = german.germanSummary(text);
  assert.equal(result.translated, false, text);
  assert.equal(result.text, text);
  assert.equal(result.original, '');
}

// Englische Zusammenfassungen der Anbieter werden ersetzt - und zwar vollstaendig.
const english = [
  'Herr Rezai called to inquire about solutions for handling numerous phone inquiries at his medical practice and asked for a call back.',
  'The agent greeted the user, who hung up almost immediately without stating a reason.',
  'Mrs. Fischer requested a quote for a bathroom renovation and asked for a call back tomorrow morning.',
  'Call was transferred to a staff member after the customer asked about heating repair costs.',
];
for (const text of english) {
  const result = german.germanSummary(text);
  assert.equal(result.translated, true, text);
  assert.equal(result.original, text, 'Originaltext bleibt fuer die Detailansicht erhalten');
  assert.ok(!/\b(the|customer|called|call back|quote|hung up|transferred|inquire)\b/i.test(result.text), 'kein englisches Wort in der Anzeige: ' + result.text);
  assert.ok(/[äöüß]|hat angerufen/i.test(result.text), 'Anzeige ist deutsch: ' + result.text);
}

// Inhalte werden uebernommen, nicht erfunden.
assert.match(german.germanSummary(english[0]).text, /Herr Rezai/);
assert.match(german.germanSummary(english[0]).text, /Rückruf gewünscht/);
assert.match(german.germanSummary(english[2]).text, /Frau Fischer/);
assert.match(german.germanSummary(english[3]).text, /weitergeleitet/);
assert.match(german.germanSummary(english[1]).text, /kein Anliegen genannt/);
assert.ok(!/Termin am|Uhr/.test(german.germanSummary(english[1]).text), 'keine Zeit erfinden');

// Leere oder sehr kurze Texte bleiben, wie sie sind.
assert.equal(german.germanSummary('').text, '');
assert.equal(german.germanSummary(null).text, '');
assert.equal(german.germanSummary('Mailbox').text, 'Mailbox');

assert.equal(german.germanSummary('Brief Interaction').text, 'Kurzes Gespräch. Ein konkretes Anliegen geht aus dem Kurztitel nicht hervor.');
assert.equal(german.germanSummary('Initial Greeting').text, 'Begrüßung zu Gesprächsbeginn. Weitere Gesprächsinhalte gehen aus dem Kurztitel nicht hervor.');
assert.ok(german.isEnglish('Microwave problem transfer'));
assert.ok(!/kein Anliegen genannt/.test(german.germanSummary('The caller hung up after a discussion.').text), 'Auflegen beweist kein fehlendes Anliegen');

console.log('German summaries passed');

const fs = require('node:fs');
const vm = require('node:vm');
const ctx = { German:german };
vm.createContext(ctx);
const session = fs.readFileSync('public/dashboard-session.js','utf8');
vm.runInContext(session.slice(session.indexOf('function providerSummaryText('), session.indexOf('// Kurze Rueckmeldung')),ctx);
vm.runInContext(session.slice(session.indexOf('function extractFieldByLabels(')),ctx);
const model = fs.readFileSync('public/dashboard-model.js','utf8');
vm.runInContext(model.slice(model.indexOf('function textStamp('),model.indexOf('function callFlags(')),ctx);
const call = {summary:'Alter Kurztitel',callAnalysis:{call_summary:'Die Heizung bleibt kalt.'}};
assert.equal(ctx.detailSummarySource(call),'Die Heizung bleibt kalt.');
call.callAnalysis.call_summary = 'Der Kunde bittet um Rückruf um 16 Uhr.';
assert.match(ctx.detailSummarySource(call),/16 Uhr/,'changed analysis invalidates cached German text');
const long = 'Der Kunde meldet eine defekte Heizung. ' + 'Das Wasser bleibt seit gestern kalt. '.repeat(8) + 'Der Zugang erfolgt über den Hinterhof.';
assert.ok(ctx.buildDetailModel({summary:long},long).anliegen.includes('Hinterhof'), 'detail view must retain the full summary');
assert.equal(ctx.mapDisconnectionReason('unknown_provider_code'),'Gespräch beendet','unknown provider codes must not leak English');
assert.ok(!ctx.summaryFor({durationMs:7000}).includes('kein Anliegen zur Sprache'),'duration alone does not establish conversation content');
console.log('German detail data and cache passed');

const paragraph = 'Die Waschmaschine ist kaputt. Der Betrieb repariert keine Haushaltsgeräte. Empfehlung: Hersteller oder Kundendienst kontaktieren.';
assert.deepEqual(Array.from(ctx.detailBulletPoints(paragraph)), [
  'Die Waschmaschine ist kaputt.',
  'Der Betrieb repariert keine Haushaltsgeräte.',
  'Empfehlung: Hersteller oder Kundendienst kontaktieren.',
]);
assert.deepEqual(Array.from(ctx.detailBulletPoints('Dr. Weber bittet um Rückruf um 16.30 Uhr. Die Nummer ist bekannt.')), ['Dr. Weber bittet um Rückruf um 16.30 Uhr.', 'Die Nummer ist bekannt.']);
assert.deepEqual(Array.from(ctx.detailBulletPoints('- Heizung defekt\n- Rückruf gewünscht')), ['Heizung defekt', 'Rückruf gewünscht']);

// Every operational fact must survive rendering above technical call metadata.
const job = [
  'Name: Herr Scherwonski',
  'Einsatzort: Nato Fufu Straße 38, Süßlof-Birk (laut Gespräch)',
  'Anliegen: Strom im Laden teilweise ausgefallen; Sicherung ausgelöst; ungewöhnlicher Geruch am Verteiler.',
  'Dringlichkeit: Sofortige Hilfe gewünscht, mögliche elektrische Gefahr.',
  'Erreichbarkeit: Muss weg; unter der Anrufnummer erreichbar, direkt ihn anrufen.',
  'Zeitangabe: 30–60 Minuten als Richtwert genannt; Verzögerungen möglich, Anfahrt nicht bestätigt.',
  'Besprochen: Abstand halten und nichts wieder einschalten.',
  'Nächster Schritt: Verfügbarkeit und tatsächliche Anfahrt klären.',
].join('\n');
Object.assign(ctx, {
  escHtml: s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'),
  topicFromCall: () => 'Elektrik', callDurationMin: () => 3.7, fmtTime: () => '27.09., 16:40',
});
const jobCall = {summary:job};
const html = ctx.detailHtml(jobCall,{badge:'problem',label:'Bitte prüfen'},ctx.buildDetailModel(jobCall,job),'+4912345');
for (const fact of ['Herr Scherwonski','Nato Fufu Straße 38','30–60 Minuten','Muss weg','nichts wieder einschalten','Verfügbarkeit']) {
  assert.ok(html.includes(fact), 'missing operational fact: ' + fact);
  assert.ok(html.indexOf(fact) < html.indexOf('detail-meta'), 'fact must precede call metadata: ' + fact);
}
assert.match(html, /<strong[^>]*>Einsatzort/,'scannable labels');
assert.equal((html.match(/Verfügbarkeit und tatsächliche Anfahrt klären/g)||[]).length,1,'no duplicated next step');
const englishCall = {summary:'The user reported a power outage and requested immediate assistance.'};
const englishHtml = ctx.detailHtml(englishCall,{badge:'problem',label:'Bitte prüfen'},ctx.buildDetailModel(englishCall),'+4912345');
assert.ok(!englishHtml.includes('The user'),'never expose untranslated provider text');
assert.match(englishHtml,/deutsche.*(?:Auswertung|Zusammenfassung)|(?:Auswertung|Zusammenfassung).*Deutsch/i,'incomplete language fallback must be explicit');
const unsafe = job.replace('Herr Scherwonski','<img src=x onerror=alert(1)>');
assert.ok(!ctx.detailHtml({summary:unsafe},{badge:'problem',label:'Bitte prüfen'},ctx.buildDetailModel({summary:unsafe}), '').includes('<img'),'escape extracted fields');
console.log('Structured German job overview passed');
const extendedJob = job + '\nPreis: 450 Euro genannt\nZusätzliche Arbeiten: Zutrittskontrolle für ca. fünf Türen\nOffen: Gesamtangebot noch klären';
const extendedCall = {summary:extendedJob};
const extendedHtml = ctx.detailHtml(extendedCall,{badge:'problem',label:'Bitte prüfen'},ctx.buildDetailModel(extendedCall), '');
const disclosure = extendedHtml.match(/<details class="detail-extra">[\s\S]*?<\/details>/)?.[0];
assert.ok(disclosure,'additional facts are collapsed by default');
assert.match(disclosure,/450 Euro/);
assert.match(disclosure,/fünf Türen/);
assert.match(disclosure,/Gesamtangebot/);
assert.ok(!disclosure.includes('nichts wieder einschalten'),'safety guidance stays visible');
assert.ok(extendedHtml.indexOf('detail-extra') < extendedHtml.indexOf('detail-meta'),'details precede technical metadata');
