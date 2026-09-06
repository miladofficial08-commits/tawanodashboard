(function (root) {
  const zone = 'Europe/Berlin';
  // Ein einziger Formatter fuer alle Aufrufe: `new Intl.DateTimeFormat` je Anruf hat
  // die Liste bei vielen Gespraechen spuerbar ausgebremst.
  let formatter = null;
  function parts(value) {
    const d = new Date(value);
    if (!Number.isFinite(d.getTime())) return {};
    if (!formatter) formatter = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23' });
    return Object.fromEntries(formatter.formatToParts(d).map(p => [p.type, p.value]));
  }
  function dateKey(value = Date.now()) {
    const p = parts(value); return p.year ? `${p.year}-${p.month}-${p.day}` : '';
  }
  function clock(value = Date.now()) {
    const p = parts(value); return p.hour ? `${p.hour}:${p.minute}` : '';
  }
  function addDays(day, count) {
    const d = new Date(day + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + count); return d.toISOString().slice(0,10);
  }
  function monday(day) {
    const weekday = new Date(day + 'T12:00:00Z').getUTCDay();
    return addDays(day, -((weekday + 6) % 7));
  }
  function fromLocal(day, time) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
    const nominal = Date.parse(day + 'T' + time + ':00Z');
    if (!Number.isFinite(nominal)) return null;
    const candidates = [1,2].map(offset => nominal - offset * 3600000)
      .filter(ms => dateKey(ms) === day && clock(ms) === time);
    return candidates.length === 1 ? new Date(candidates[0]).toISOString() : null;
  }
  function inRange(value, start, end) {
    const day = dateKey(value); return Boolean(day && (!start || day >= start) && (!end || day <= end));
  }
  function pad(value) { return String(value).padStart(2, '0'); }
  function isZoned(value) {
    return /^\d{4}-\d{2}-\d{2}[T ]/.test(value) && /(Z|[+-]\d{2}:?\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
  }
  // Ein vom Telefonassistenten geliefertes Datum in einen Tagesschluessel bringen.
  function structuredDay(value, base) {
    const raw = String(value == null ? '' : value).trim();
    if (!raw) return null;
    if (isZoned(raw)) return dateKey(raw);
    let match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return `${match[1]}-${match[2]}-${match[3]}`;
    match = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})?/);
    if (match) {
      const year = match[3] || base.slice(0, 4);
      let day = `${year}-${pad(match[2])}-${pad(match[1])}`;
      if (!match[3] && day < base) day = String(Number(base.slice(0, 4)) + 1) + day.slice(4);
      return day;
    }
    const word = raw.toLowerCase();
    if (word === 'heute' || word === 'today') return base;
    if (word === 'morgen' || word === 'tomorrow') return addDays(base, 1);
    if (word === 'übermorgen' || word === 'uebermorgen') return addDays(base, 2);
    return null;
  }
  // Uhrzeit aus "16:00", "16.30", "16", "16 Uhr", "4 pm" oder einem vollen Zeitstempel.
  function structuredTime(value) {
    const raw = String(value == null ? '' : value).trim();
    if (!raw) return null;
    if (isZoned(raw)) return clock(raw);
    const match = raw.match(/^(\d{1,2})(?:[:.](\d{2}))?/);
    if (!match) return null;
    let hour = Number(match[1]);
    const minute = Number(match[2] || 0);
    if (/pm/i.test(raw) && hour < 12) hour += 12;
    if (/am/i.test(raw) && hour === 12) hour = 0;
    if (!(hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59)) return null;
    return pad(hour) + ':' + pad(minute);
  }
  // Strukturierte Rueckrufzeit des Telefonassistenten (Datenfeld statt Freitext).
  // Liefert null, wenn nichts Eindeutiges dabei ist - dann greift parse() weiter.
  function fromStructured(fields, createdAt) {
    if (!fields || typeof fields !== 'object') return null;
    if (/^(nein|no|false|0|none|kein|keine)$/i.test(String(fields.wanted == null ? '' : fields.wanted).trim())) return null;
    const base = dateKey(createdAt);
    if (!base) return null;
    const at = String(fields.at == null ? '' : fields.at).trim();
    const parts = at ? at.split(/[T\s]+/) : [];
    const day = structuredDay(at && isZoned(at) ? at : (parts[0] || ''), base) || structuredDay(fields.date, base);
    if (!day || !fromLocal(day, '12:00')) return null;
    let time = (at ? structuredTime(isZoned(at) ? at : (parts[1] || '')) : null) || structuredTime(fields.time);
    let iso = null;
    if (time) {
      iso = isZoned(at) ? new Date(at).toISOString() : fromLocal(day, time);
      if (!iso) time = null; // Zeitumstellung: Tag steht, Uhrzeit muss geklaert werden.
    }
    const end = structuredTime(fields.end);
    const validEnd = end && fromLocal(day, end) && (!time || end > time) ? end : null;
    return { day, time: time || null, end: validEnd, iso, label: 'Vom Telefonassistenten' };
  }
  function parse(text, createdAt) {
    const empty = {day:null, time:null, end:null, iso:null, label:'Zeit noch klären'};
    const base = dateKey(createdAt);
    if (!base) return empty;
    const sentences = String(text || '').split(/(?<=[!?])\s+|(?<=\.)\s+(?=[A-ZÄÖÜ])|\n/)
      .filter(s => /rückruf|rueckruf|zurückruf|zurueckruf|erreichbar|callback|call back/i.test(s));
    const results = [];
    for (const s of sentences) {
      if (/kein(?:en)? Rückruf|nicht zurückrufen|no callback/i.test(s)) continue;
      let day = null;
      if (/übermorgen|uebermorgen/i.test(s)) day = addDays(base, 2);
      else if (/\bmorgen\b/i.test(s)) day = addDays(base, 1);
      else if (/\bheute\b/i.test(s)) day = base;
      const weekday = s.match(/\b(?:am|nächsten|naechsten)\s+(Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag)/i);
      if (!day && weekday) {
        const n = ['montag','dienstag','mittwoch','donnerstag','freitag','samstag','sonntag'].indexOf(weekday[1].toLowerCase());
        const current = (new Date(base + 'T12:00:00Z').getUTCDay()+6)%7;
        const delta = (n-current+7)%7;
        day = addDays(base, delta || (/nächsten|naechsten/i.test(weekday[0]) ? 7 : 0));
      }
      const explicit = s.match(/\bam\s+(\d{1,2})\.(\d{1,2})\.(?:(\d{4})\b)?/i);
      if (explicit) {
        day = `${explicit[3] || base.slice(0,4)}-${explicit[2].padStart(2,'0')}-${explicit[1].padStart(2,'0')}`;
        if (!explicit[3] && day < base) day = String(Number(base.slice(0,4))+1)+day.slice(4);
      }
      const match = s.match(/\b(?:um|ab|zwischen|von)\s+(\d{1,2})(?:[:.](\d{2}))?(?:\s*(?:und|bis|–|-)\s*(\d{1,2})(?:[:.](\d{2}))?)?\s*(?:Uhr)?/i);
      const time = match ? match[1].padStart(2,'0')+':'+(match[2]||'00') : null;
      const end = match && match[3] ? match[3].padStart(2,'0')+':'+(match[4]||'00') : null;
      const validDay = day && fromLocal(day, '12:00');
      const iso = validDay && time ? fromLocal(day, time) : null;
      if (day && !validDay || time && day && !iso || end && (!fromLocal(day, end) || end <= time)) continue;
      if (day) results.push({day, time:iso ? time : null, end, iso, label:s.trim()});
    }
    if (results.length !== 1) return empty;
    return results[0];
  }
  const api = { zone, dateKey, clock, addDays, monday, fromLocal, inRange, parse, fromStructured };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PlannerTime = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
