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

console.log('German summaries passed');
