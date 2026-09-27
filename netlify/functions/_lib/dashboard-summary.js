/** @param {Record<string, unknown>} fields @returns {string} German labelled facts, or empty if extraction is incomplete. */
function dashboardSummary(fields = {}) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return '';
  const value = key => {
    const item = fields[key];
    const raw = item && typeof item === 'object' ? item.value : item;
    if (typeof raw !== 'string') return '';
    const text = raw.replace(/\s+/g, ' ').trim();
    return /^(?:null|none|n\/?a|nicht genannt|keine angaben|unbekannt)[.!]?$/i.test(text) ? '' : text;
  };
  if (!value('dashboard_issue')) return '';
  const time = value('dashboard_time');
  const unconfirmed = /nicht bestätigt|unbestätigt/i.test(time);
  const next = unconfirmed && /elektrische Gefahr/i.test(value('dashboard_urgency'))
    ? 'Dringend zurückrufen und Verfügbarkeit sowie Anfahrt klären.'
    : unconfirmed && /wunsch/i.test(time) ? 'Zurückrufen und Terminwunsch abstimmen.' : value('dashboard_next');
  const labels = [
    ['dashboard_name', 'Name'], ['dashboard_address', 'Einsatzort'],
    ['dashboard_issue', 'Anliegen'], ['dashboard_urgency', 'Dringlichkeit'],
    ['dashboard_contact', 'Erreichbarkeit'], ['dashboard_time', 'Zeitangabe'],
    ['dashboard_price', 'Preis'], ['dashboard_additional', 'Zusätzliche Arbeiten'],
    ['dashboard_notes', 'Besprochen'], ['dashboard_next', 'Nächster Schritt'],
  ];
  return labels.map(([key, label]) => {
    const text = (key === 'dashboard_next' ? next : value(key)) || (['dashboard_name', 'dashboard_address'].includes(key) ? 'Nicht genannt' : '');
    return text ? label + ': ' + text : '';
  }).filter(Boolean).join('\n');
}

module.exports = { dashboardSummary };
