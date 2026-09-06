// Beispieldaten. Zwei Wege, beide nur mit ausdruecklichem Schalter:
//   ?preview=1  nur auf localhost  -> Design-Vorschau beim Entwickeln
//   ?demo=1     ueberall           -> Beispiel-Dashboard zum Herzeigen (Vertrieb)
// Beide laufen komplett ohne Login und ohne Schreibzugriff: previewMode schaltet
// jede API-Aktion ab (siehe saveWork, refreshCalls, contactCustomer, start-call).
// Ein echter Kundenzugang sieht NIE Beispieldaten.
const previewHost = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
const previewParams = new URLSearchParams(location.search);
const demoMode = previewParams.get('demo') === '1';
const previewMode = (previewHost && previewParams.get('preview') === '1') || demoMode;
if (!previewHost) document.querySelectorAll('.preview-link').forEach(link => { link.hidden = true; });

const DEMO_TENANT = { id:'demo-handwerk', name:'Bergmann Haustechnik', provider:'elevenlabs', detailed_analysis:true, minutes_budget:500 };

// Gespraeche fuer das Beispiel-Dashboard: fester Ablauf statt Zufall, damit jede
// Vorfuehrung gleich aussieht. Verteilt ueber die letzten drei Wochen.
const DEMO_SCRIPT = [
  ['Thomas Weber', 'Rückruf gewünscht: Die Heizung im Einfamilienhaus bleibt kalt. Herr Weber bittet um einen Termin zur Reparatur und ist heute zwischen 16 und 18 Uhr erreichbar.', 205, 'callback'],
  ['Sabine Fischer', 'Angebot für eine Badsanierung angefragt. Frau Fischer möchte die Dusche erneuern lassen. Bitte morgen um 9 Uhr zurückrufen und einen Besichtigungstermin abstimmen.', 174, 'callback'],
  ['Michael Braun', 'Termin für die jährliche Heizungswartung besprochen. Die Anfrage wurde an das Büro weitergeleitet.', 126, 'transfer'],
  ['Anna Schneider', 'Frau Schneider hat nach den Öffnungszeiten gefragt. Der Telefonassistent hat die Bürozeiten genannt.', 62, 'done'],
  ['Peter Hoffmann', 'Rückruf gewünscht: Herr Hoffmann hat eine Frage zum bestehenden Angebot für eine Wärmepumpe. Rückruf heute um 15:15 Uhr gewünscht.', 183, 'callback'],
  ['Laura Wagner', 'Die Anruferin hat die Adresse des Betriebs erfragt und die Information erhalten.', 48, 'done'],
  ['Jürgen Klein', 'Wasserschaden im Keller gemeldet. Herr Klein bittet dringend um einen Rückruf, er ist ganztägig erreichbar.', 268, 'callback'],
  ['Familie Özdemir', 'Neubau: Anfrage für ein Angebot zur kompletten Sanitärinstallation. Rückruf am Montag um 10 Uhr gewünscht.', 322, 'callback'],
  ['Renate Vogt', 'Frau Vogt fragt nach dem Termin für den Heizungscheck. Der Termin wurde bestätigt.', 96, 'done'],
  ['Stefan Lorenz', 'Der Anrufer wollte einen Mitarbeiter sprechen. Das Gespräch wurde weitergeleitet.', 71, 'transfer'],
  ['Bäckerei Sommer', 'Störung an der Lüftung in der Backstube. Rückruf gewünscht, am besten morgen früh vor 7 Uhr.', 241, 'callback'],
  ['Katrin Berger', 'Frau Berger hat nach den Kosten für eine neue Therme gefragt. Angebot wurde zugesagt, Rückruf morgen um 14 Uhr.', 199, 'callback'],
  ['Hausverwaltung Prinz', 'Wartungsvertrag für sechs Objekte angefragt. Unterlagen sollen per Post kommen.', 288, 'callback'],
  ['Dirk Nowak', 'Der Anrufer hat aufgelegt, bevor ein Anliegen genannt wurde.', 14, 'problem'],
  ['Elke Brandt', 'Frau Brandt meldet einen tropfenden Wasserhahn in der Küche. Termin nächste Woche gewünscht.', 158, 'callback'],
  ['Autohaus Reuter', 'Anfrage zur Wartung der Hallenheizung. Rückruf am Dienstag um 11 Uhr vereinbart.', 214, 'callback'],
];
const DEMO_NUMBERS = ['+4915112345601','+4915112345602','+4917612345603','+4917612345604','+4930123456705','+4930123456706','+4916212345607','+4916212345608'];

function demoCalls() {
  const now = new Date();
  const rows = [];
  for (let index = 0; index < 64; index += 1) {
    const [name, summary, duration, kind] = DEMO_SCRIPT[index % DEMO_SCRIPT.length];
    const daysBack = Math.floor(index / 3.2);
    const at = new Date(now);
    at.setDate(at.getDate() - daysBack);
    at.setHours(8 + ((index * 5) % 10), (index * 17) % 60, 0, 0);
    if (at > now) at.setDate(at.getDate() - 1);
    const id = 'demo-' + index;
    const older = daysBack > 2;
    rows.push({
      id, call_id: id, agent_id: 'demo-agent', provider: 'elevenlabs',
      customerName: index < DEMO_SCRIPT.length ? name : '', name: index < DEMO_SCRIPT.length ? name : '',
      summary, call_analysis: { call_summary: summary, user_sentiment: kind === 'problem' ? 'Negativ' : 'Positiv' },
      status: 'ended',
      disconnectionReason: kind === 'transfer' ? 'call_transfer' : 'user_hangup',
      phoneNumber: DEMO_NUMBERS[index % DEMO_NUMBERS.length],
      direction: 'inbound',
      durationMs: Math.round(duration * 1000 * (0.7 + ((index % 7) / 10))),
      createdAt: at.toISOString(),
      // Aeltere Vorgaenge sind abgearbeitet - so sieht man Plan und Historie zugleich.
      work: older ? { state: 'done', state_manual: true, notes: index % 5 === 0 ? 'Kunde erreicht, Termin steht.' : '', updated_at: at.toISOString() } : undefined,
    });
  }
  return rows;
}

function previewCalls() {
  if (demoMode) return demoCalls();
  return DEMO_SCRIPT.slice(0, 6).map(([name, summary, duration], i) => ({
    id:'preview-'+i, call_id:'preview-'+i, agent_id:'preview-agent', customerName:name, name, summary,
    status:'ended', provider:'elevenlabs', phoneNumber:'+4930000000'+i, durationMs:duration*1000,
    createdAt:new Date(new Date().setHours(11, 42 - i * 23, 0, 0)).toISOString(), call_analysis:{call_summary:summary},
  }));
}

// Bewertungen fuer die Feedback-Seite (nur Beispielmodus).
function previewFeedback() {
  if (!previewMode) return [];
  const ratings = demoMode ? [5,5,4,5,3,5,4,5,5,2,4,5,5,4,5,3,5,4] : [5,4,5,3,5];
  const now = Date.now();
  return ratings.map((rating, index) => ({
    rating,
    phone_number: DEMO_NUMBERS[index % DEMO_NUMBERS.length],
    created_at: new Date(now - (index * 19 + 3) * 3600000).toISOString(),
  }));
}

const adminPreview = previewHost && previewParams.get('preview') === '1';
const previewCustomers = [
  {id:'preview-1',name:'Bergmann Haustechnik',provider:'elevenlabs',elevenlabs_agent_id:'agent_beispiel_haustechnik',is_active:true,stats:{calls:38,minutes:86,lastAt:new Date().toISOString()},detailed_analysis:true,sms_enabled:false},
  {id:'preview-2',name:'Holzwerk Schuster',provider:'elevenlabs',elevenlabs_agent_id:'agent_beispiel_holzwerk',is_active:true,stats:{calls:21,minutes:44,lastAt:new Date().toISOString()},detailed_analysis:true,sms_enabled:false},
  {id:'preview-3',name:'Elektro König',provider:'retell',retell_agent_id:'agent_beispiel_elektro',is_active:true,stats:{calls:16,minutes:32,lastAt:new Date().toISOString()},detailed_analysis:true,sms_enabled:false},
];
function filterCustomers(query) {
  document.querySelectorAll('.cust').forEach(card => { card.hidden = !card.textContent.toLowerCase().includes(query.toLowerCase()); });
}
