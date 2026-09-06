// Kein Englisch im Dashboard.
//
// Retell und ElevenLabs liefern die Gespraechszusammenfassung in der Sprache des
// Agenten - haeufig Englisch ("Herr Rezai called to inquire about ..."). Der
// Handwerker soll das nie lesen muessen. Hier wird englischer Text erkannt und
// durch einen deutschen Satz ersetzt, der ausschliesslich aus dem Text abgeleitet
// wird. Es wird nichts dazuerfunden; der Originaltext bleibt im Detail sichtbar.
//
// Dauerhaft besser ist die Sprache am Agenten selbst (Post Call Analysis auf
// Deutsch) - das hier ist die Absicherung fuer alles, was trotzdem englisch kommt.
(function (root) {
  const ENGLISH = /\b(the|and|for|with|his|her|their|about|was|were|has|have|call|called|calls|caller|customer|client|appointment|callback|inquire|inquiry|inquiries|request|requested|would|like|please|number|phone|service|services|solution|solutions|regarding|asked|asking|wants|wanted|needs|needed|hours|price|quote|offer|information|schedule|scheduled|available|practice|company|business|during|after|before|however|therefore|is|are|it|that|of|from|will|can|there|this|these|those|because|when|who|which|been|being|does|did|customer's|leaking|greeted)\b/gi;
  const GERMAN = /\b(der|die|das|und|nicht|ein|eine|einen|für|fuer|mit|sich|hat|wurde|ruft|angerufen|anrufer|kunde|kundin|termin|rückruf|rueckruf|bitte|nummer|telefon|angebot|preis|öffnungszeiten|oeffnungszeiten|uhr|heute|morgen|wollte|möchte|moechte|gewünscht|gewuenscht|erreichbar|gefragt|genannt)\b/gi;

  // Thema -> deutsche Beschreibung. Reihenfolge = Rangfolge (Notfall vor Auskunft).
  const TOPICS = [
    [/\b(emergency|urgent|asap)\b/i, 'einen dringenden Fall'],
    [/\b(heating|boiler|radiator|furnace)\b/i, 'die Heizung'],
    [/\b(water|leak|leaking|plumb\w*|pipe|drain|bathroom)\b/i, 'Wasser oder Sanitär'],
    [/\b(electric\w*|power|socket|fuse|wiring)\b/i, 'Elektrik'],
    [/\b(appointment|book\w*|schedule\w*|visit)\b/i, 'einen Termin'],
    [/\b(quote|quotation|offer|estimate|pricing|price|cost\w*)\b/i, 'ein Angebot oder den Preis'],
    [/\b(invoice|bill|billing|payment|paid)\b/i, 'eine Rechnung'],
    [/\b(complaint|complain\w*|unhappy|dissatisfied|angry)\b/i, 'eine Beschwerde'],
    [/\b(opening hours|business hours|open today|closing time)\b/i, 'die Öffnungszeiten'],
    [/\b(address|location|directions|where.{0,12}located)\b/i, 'die Adresse'],
    [/\b(maintenance|service contract|repair\w*|fix\w*|broken|not working)\b/i, 'eine Reparatur oder Wartung'],
    [/\b(inquire|inquiry|inquiries|information|question\w*|asked about|interested)\b/i, 'eine Auskunft'],
  ];

  function count(text, pattern) {
    const found = String(text || '').match(pattern);
    return found ? found.length : 0;
  }
  // Englisch nur annehmen, wenn deutlich mehr englische als deutsche Signalwoerter
  // auftauchen - deutsche Texte mit einem Fremdwort bleiben unangetastet.
  function isEnglish(text) {
    const value = String(text || '').trim();
    if (value.length < 12) return false;
    const english = count(value, ENGLISH);
    return english >= 2 && english > count(value, GERMAN);
  }
  function person(text) {
    const match = String(text || '').match(/\b(Mr\.?|Mrs\.?|Ms\.?|Herr|Frau)\s+([A-ZÄÖÜ][\wäöüß-]{1,24})/);
    if (!match) return '';
    return (/^(mrs|ms|frau)/i.test(match[1]) ? 'Frau ' : 'Herr ') + match[2];
  }
  function joinList(parts) {
    if (parts.length < 2) return parts[0] || '';
    return parts.slice(0, -1).join(', ') + ' und ' + parts[parts.length - 1];
  }
  // Deutscher Satz aus dem, was im englischen Text tatsaechlich steht.
  function rewrite(text) {
    const value = String(text || '');
    const topics = TOPICS.filter(([pattern]) => pattern.test(value)).slice(0, 2).map(([, label]) => label);
    const who = person(value) || 'Der Anrufer';
    const parts = [who + ' hat angerufen' + (topics.length ? ' – es ging um ' + joinList(topics) : '') + '.'];
    if (/\b(call ?back|callback|return (?:the |his |her )?call)\b/i.test(value)) parts.push('Rückruf gewünscht.');
    if (/\b(transfer\w*|forward\w*|colleague|staff member)\b/i.test(value)) parts.push('Das Gespräch sollte weitergeleitet werden.');
    if (/\b(voicemail|mailbox|answering machine)\b/i.test(value)) parts.push('Es wurde die Mailbox erreicht.');
    if (/\b(hung up|hang up|disconnected|ended the call)\b/i.test(value) && topics.length === 0) parts.push('Es wurde kein Anliegen genannt.');
    if (!topics.length && parts.length === 1) parts.push('Das Anliegen geht aus der Zusammenfassung des Anbieters nicht klar hervor.');
    return parts.join(' ');
  }
  // {text, translated, original}: `text` ist immer deutsch, `original` nur gesetzt,
  // wenn der Anbietertext ersetzt wurde (fuer die Anzeige im Detail).
  function germanSummary(text) {
    const value = String(text == null ? '' : text).trim();
    if (!value) return { text: '', translated: false, original: '' };
    if (!isEnglish(value)) return { text: value, translated: false, original: '' };
    return { text: rewrite(value), translated: true, original: value };
  }

  const api = { isEnglish, germanSummary, rewrite };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.German = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
