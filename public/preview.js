const previewHost = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
const previewMode = previewHost && new URLSearchParams(location.search).get('preview') === '1';
if (!previewHost) document.querySelectorAll('.preview-link').forEach(link => { link.hidden = true; });
function previewCalls() {
  const rows = [
    ['Thomas Weber', 'Rückruf gewünscht: Die Heizung im Einfamilienhaus bleibt kalt. Herr Weber bittet um einen Termin zur Reparatur und ist heute zwischen 16 und 18 Uhr erreichbar.', 205],
    ['Sabine Fischer', 'Angebot für eine Badsanierung angefragt. Frau Fischer möchte die Dusche erneuern lassen. Bitte morgen um 9 Uhr zurückrufen und einen Besichtigungstermin abstimmen.', 174],
    ['Michael Braun', 'Termin für die jährliche Heizungswartung besprochen. Die Anfrage wurde an das Büro weitergeleitet.', 126],
    ['Anna Schneider', 'Frau Schneider hat nach den Öffnungszeiten gefragt. Der Telefonassistent hat die Bürozeiten genannt.', 62],
    ['Peter Hoffmann', 'Rückruf gewünscht: Herr Hoffmann hat eine Frage zum bestehenden Angebot für eine Wärmepumpe. Rückruf heute um 15:15 Uhr gewünscht.', 183],
    ['Laura Wagner', 'Die Anruferin hat die Adresse des Betriebs erfragt und die Information erhalten.', 48],
  ];
  return rows.map(([name, summary, duration], i) => ({ id:'preview-'+i, call_id:'preview-'+i, agent_id:'preview-agent', customerName:name, name, summary, status:'ended', provider:'elevenlabs', phoneNumber:'+4930000000'+i, durationMs:duration*1000, createdAt:new Date(new Date().setHours(11,42-i*23,0,0)).toISOString(), call_analysis:{call_summary:summary} }));
}
const adminPreview = previewMode;
const previewCustomers = [
  {id:'preview-1',name:'Bergmann Haustechnik',provider:'elevenlabs',elevenlabs_agent_id:'agent_beispiel_haustechnik',is_active:true,stats:{calls:38,minutes:86,lastAt:new Date().toISOString()},detailed_analysis:true,sms_enabled:false},
  {id:'preview-2',name:'Holzwerk Schuster',provider:'elevenlabs',elevenlabs_agent_id:'agent_beispiel_holzwerk',is_active:true,stats:{calls:21,minutes:44,lastAt:new Date().toISOString()},detailed_analysis:true,sms_enabled:false},
  {id:'preview-3',name:'Elektro König',provider:'retell',retell_agent_id:'agent_beispiel_elektro',is_active:true,stats:{calls:16,minutes:32,lastAt:new Date().toISOString()},detailed_analysis:true,sms_enabled:false},
];
function filterCustomers(query) {
  document.querySelectorAll('.cust').forEach(card => { card.hidden = !card.textContent.toLowerCase().includes(query.toLowerCase()); });
}
