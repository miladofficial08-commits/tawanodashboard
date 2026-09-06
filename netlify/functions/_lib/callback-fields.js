// Strukturierte Rueckrufzeit aus der Nachbearbeitung des Telefonassistenten.
//
// Freitext ("Rückruf morgen um 16 Uhr") wird im Dashboard weiterhin gelesen, ist aber
// nur so gut wie die Formulierung. Zuverlaessig ist ein eigenes Datenfeld, das der
// Assistent nach dem Gespraech selbst fuellt:
//   Retell:     call_analysis.custom_analysis_data  (Post Call Analysis)
//               bzw. collected_dynamic_variables / retell_llm_dynamic_variables
//   ElevenLabs: analysis.data_collection_results    (Data Collection)
// Erwartete Feldnamen siehe KEYS - hier wird nur eingesammelt und als Text
// weitergereicht; geprueft und in eine echte Zeit umgerechnet wird in
// public/planner-time.js, damit Server und Anzeige dieselbe Regel benutzen.

const KEYS = {
  at: ['callback_at', 'callback_datetime', 'callback_iso', 'rueckruf_zeitpunkt', 'rückruf_zeitpunkt'],
  date: ['callback_date', 'callback_day', 'rueckruf_datum', 'rückruf_datum', 'rueckruf_tag', 'rückruf_tag'],
  time: ['callback_time', 'callback_hour', 'rueckruf_uhrzeit', 'rückruf_uhrzeit', 'rueckruf_zeit', 'rückruf_zeit'],
  end: ['callback_end', 'callback_time_end', 'callback_until', 'rueckruf_ende', 'rückruf_ende', 'rueckruf_bis', 'rückruf_bis'],
  wanted: ['callback_wanted', 'callback_requested', 'rueckruf_gewuenscht', 'rückruf_gewünscht'],
};

function normalizeKey(key) {
  return String(key || '').trim().toLowerCase().replace(/[\s.-]+/g, '_');
}

// Einen Anbieter-Block auf eine flache Map "feldname -> text" bringen.
// Unterstuetzt einfache Objekte ({callback_date:"2026-09-08"}), ElevenLabs-Maps
// ({callback_date:{value:"2026-09-08",rationale:"..."}}) und deren Listenform.
function flatten(source) {
  const flat = {};
  const add = (key, value) => {
    const name = normalizeKey(key);
    if (!name || flat[name] !== undefined) return;
    const raw = value && typeof value === 'object' && !Array.isArray(value) ? value.value : value;
    if (raw === null || raw === undefined || typeof raw === 'object') return;
    const text = String(raw).trim();
    if (text) flat[name] = text;
  };
  if (Array.isArray(source)) {
    source.forEach((entry) => {
      if (!entry || typeof entry !== 'object') return;
      add(entry.data_collection_id || entry.id || entry.name || entry.key, entry);
    });
  } else if (source && typeof source === 'object') {
    Object.entries(source).forEach(([key, value]) => add(key, value));
  }
  return flat;
}

// Mehrere Quellen zusammenfuehren; die erste Quelle mit einem Wert gewinnt.
function callbackFields(...sources) {
  const flat = {};
  sources.forEach((source) => {
    Object.entries(flatten(source)).forEach(([key, value]) => { if (flat[key] === undefined) flat[key] = value; });
  });
  const fields = {};
  Object.entries(KEYS).forEach(([field, names]) => {
    const hit = names.map(normalizeKey).find((name) => flat[name] !== undefined);
    if (hit) fields[field] = flat[hit];
  });
  return Object.keys(fields).length ? fields : null;
}

module.exports = {callbackFields, KEYS};
