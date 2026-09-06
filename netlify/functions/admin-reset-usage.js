// Resets fuer einen Kunden - nur mit Admin-Secret.
//
//   minutes       Minutenzaehlung beginnt ab jetzt bei 0 (Budget bleibt).
//   conversations Gespraechsansicht beginnt ab jetzt (aeltere bleiben gespeichert,
//                 werden aber nicht mehr angezeigt).
//   all           Vollstaendiger Reset: gespeicherte Gespraeche, Notizen,
//                 Rueckruftermine, Rueckrufauftraege und Bewertungen dieses Kunden
//                 werden geloescht, beide Startzeitpunkte neu gesetzt. Zugang,
//                 Agent und Einstellungen bleiben; Aufnahmen beim Telefonanbieter
//                 bleiben ebenfalls unberuehrt.
const {envValue,readBody,json,getTenantById,patchRows,deleteRows,isMissingSchemaError} = require('./_lib/tenant');

// Tabellen, die beim vollstaendigen Reset geleert werden (jeweils nur fuer diesen
// Mandanten). Fehlt eine Tabelle in der Installation, wird sie uebersprungen.
const WIPE_TABLES = ['call_workspace', 'call_sync_state', 'callback_requests', 'sms_feedback'];

async function wipeTenantData(tenantId) {
  const removed = {};
  for (const table of WIPE_TABLES) {
    try {
      const rows = await deleteRows(table, {tenant_id: 'eq.' + tenantId}, {serviceRole: true});
      removed[table] = rows.length;
    } catch (error) {
      if (!isMissingSchemaError(error)) throw error;
      removed[table] = 0;
    }
  }
  return removed;
}

exports.handler = async event => {
  if (event.httpMethod !== 'POST') return json(405,{ok:false,message:'Method Not Allowed'});
  const body = readBody(event) || {};
  const secret = envValue('ADMIN_SECRET').trim();
  if (!secret || body.admin_secret !== secret) return json(401,{ok:false,message:'Nicht autorisiert.'});
  if (!['minutes','conversations','all'].includes(body.mode)) return json(400,{ok:false,message:'Reset-Art fehlt.'});
  if (typeof body.tenant_id !== 'string' || !body.tenant_id.trim()) return json(400,{ok:false,message:'Kunde fehlt.'});
  // Das Loeschen ist nicht umkehrbar - es braucht eine ausdrueckliche Bestaetigung.
  if (body.mode === 'all' && body.confirm !== true) return json(400,{ok:false,message:'Löschen muss ausdrücklich bestätigt werden.'});
  try {
    const tenant = await getTenantById(body.tenant_id,{serviceRole:true});
    if (!tenant) return json(404,{ok:false,message:'Kunde nicht gefunden.'});
    const now = new Date().toISOString();
    let removed = null;
    if (body.mode === 'all') removed = await wipeTenantData(tenant.id);
    const patch = body.mode === 'minutes' ? {minutes_reset_at:now}
      : body.mode === 'conversations' ? {go_live_at:now}
      : {minutes_reset_at:now, go_live_at:now};
    const rows = await patchRows('tenants',{id:'eq.'+tenant.id},{...patch,updated_at:now},{serviceRole:true});
    if (!rows.length) throw new Error('Reset nicht gespeichert.');
    const message = body.mode === 'minutes' ? 'Minuten werden ab jetzt neu gezählt.'
      : body.mode === 'conversations' ? 'Gesprächsansicht beginnt ab jetzt. Frühere Gespräche sind ausgeblendet.'
      : 'Alles zurückgesetzt: ' + (removed ? Object.values(removed).reduce((sum, count) => sum + count, 0) : 0) + ' Einträge gelöscht. Minuten und Gesprächsansicht starten neu.';
    return json(200,{ok:true,reset_at:now,removed,message});
  } catch(e) { return json(500,{ok:false,message:e.message || 'Reset fehlgeschlagen.'}); }
};
