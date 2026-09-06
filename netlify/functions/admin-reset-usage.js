const {envValue,readBody,json,getTenantById,patchRows} = require('./_lib/tenant');
exports.handler = async event => {
  if (event.httpMethod !== 'POST') return json(405,{ok:false,message:'Method Not Allowed'});
  const body = readBody(event) || {};
  const secret = envValue('ADMIN_SECRET').trim();
  if (!secret || body.admin_secret !== secret) return json(401,{ok:false,message:'Nicht autorisiert.'});
  if (!['minutes','conversations'].includes(body.mode)) return json(400,{ok:false,message:'Reset-Art fehlt.'});
  if (typeof body.tenant_id !== 'string' || !body.tenant_id.trim()) return json(400,{ok:false,message:'Kunde fehlt.'});
  try {
    const tenant = await getTenantById(body.tenant_id,{serviceRole:true});
    if (!tenant) return json(404,{ok:false,message:'Kunde nicht gefunden.'});
    const now = new Date().toISOString();
    const patch = body.mode === 'minutes' ? {minutes_reset_at:now} : {go_live_at:now};
    const rows = await patchRows('tenants',{id:'eq.'+tenant.id},{...patch,updated_at:now},{serviceRole:true});
    if (!rows.length) throw new Error('Reset nicht gespeichert.');
    return json(200,{ok:true,reset_at:now,message:body.mode==='minutes'?'Minuten werden ab jetzt neu gezählt.':'Gesprächsansicht beginnt ab jetzt. Frühere Gespräche sind ausgeblendet.'});
  } catch(e) { return json(500,{ok:false,message:e.message || 'Reset fehlgeschlagen.'}); }
};
