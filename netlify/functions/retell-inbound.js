// Retell Inbound-Call-Webhook.
// Retell ruft diese URL auf, SOBALD ein Anruf eingeht (bevor der Agent startet) und
// erwartet dynamische Variablen + Metadaten zurueck. Damit bekommen Inbound-Calls
// dasselbe wie Outbound (siehe start-call.js): current_date + Tenant-Zuordnung + echte Anrufernummer.
//
// In Retell konfigurieren: pro Nummer/Agent "Inbound Call Webhook URL" = /api/retell-inbound
//
// Antwortformat (Retell erwartet genau diese Struktur):
//   { "call_inbound": { "dynamic_variables": {...}, "metadata": {...} } }
//
// Damit die Tools die Werte auch nutzen, im Agent verwenden:
//   - Prompt/Slots:  {{current_date}}   (statt vom Modell geratenem Datum)
//   - SMS an Anrufer: phone_number = {{caller_number}}
//   - Tenant:         tenant_id = {{tenant_id}}

const { json, readBody, getTenantByPhoneNumber, getTenantByAgentId } = require('./_lib/tenant');

function currentDateInTimeZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZone || 'Europe/Berlin',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date || new Date());
  const by = {};
  parts.forEach((p) => { by[p.type] = p.value; });
  return by.year + '-' + by.month + '-' + by.day;
}

// Tenant zuerst ueber die angerufene Geschaeftsnummer (eindeutig pro Kunde), sonst ueber den Agent.
async function resolveTenant(toNumber, agentId) {
  if (toNumber) {
    try { const t = await getTenantByPhoneNumber(toNumber, { serviceRole: true }); if (t) return t; } catch (_) {}
  }
  if (agentId) {
    try { const t = await getTenantByAgentId(agentId, { serviceRole: true }); if (t) return t; } catch (_) {}
  }
  return null;
}

exports.handler = async (event) => {
  const raw = readBody(event) || {};
  // Retell schickt { event:'call_inbound', call_inbound:{ agent_id, from_number, to_number } }.
  const inbound = (raw.call_inbound && typeof raw.call_inbound === 'object') ? raw.call_inbound : raw;
  const fromNumber = String(inbound.from_number || inbound.caller_number || '').trim();
  const toNumber = String(inbound.to_number || inbound.called_number || '').trim();
  const agentId = String(inbound.agent_id || '').trim();

  const currentDate = currentDateInTimeZone(new Date(), 'Europe/Berlin');
  const tenant = await resolveTenant(toNumber, agentId);

  const dynamic_variables = {
    current_date: currentDate,                    // behebt falsches Datum in get_available_slots
    caller_number: fromNumber,                    // echte Anrufernummer fuer send_confirmation_sms
    tenant_id: (tenant && tenant.id) || '',
    tenant_name: (tenant && tenant.name) || '',
  };
  const metadata = {
    source: 'inbound',
    tenant_id: (tenant && tenant.id) || null,     // -> Tools finden den richtigen Mandanten
    tenant_name: (tenant && tenant.name) || null,
    caller_number: fromNumber || null,
    called_number: toNumber || null,
    inbound_current_date: currentDate,
  };

  // override_agent_id ist optional (Nummer hat i. d. R. schon einen Default-Agent).
  // Wir spiegeln die eingehende agent_id zurueck -> garantiert Pickup, ohne Routing zu aendern.
  const call_inbound = { dynamic_variables, metadata };
  if (agentId) call_inbound.override_agent_id = agentId;

  return json(200, { call_inbound });
};

exports.__test = { currentDateInTimeZone, resolveTenant };
