const {bearerTokenFromEvent,resolveTenantContextFromAccessToken,readBody,json,listRows,patchRows} = require('./_lib/tenant');
const {scope} = require('./_lib/call-workspace');

exports.handler = async event => {
  if (event.httpMethod !== 'POST') return json(405,{ok:false,message:'Method Not Allowed'});
  const token = bearerTokenFromEvent(event);
  if (!token) return json(401,{ok:false,message:'Bitte anmelden.'});
  try {
    const {tenant} = await resolveTenantContextFromAccessToken(token);
    const body = readBody(event) || {};
    if (typeof body.call_id !== 'string' || !body.call_id || body.call_id.length > 200) return json(400,{ok:false,message:'Gespräch fehlt.'});
    const patch = {updated_at:new Date().toISOString()};
    if (body.state !== undefined) {
      if (!['open','done','deleted'].includes(body.state)) return json(400,{ok:false,message:'Ungültiger Status.'});
      patch.state = body.state;
      patch.state_manual = true;
    }
    if (body.notes !== undefined) {
      if (typeof body.notes !== 'string' || body.notes.length > 5000) return json(400,{ok:false,message:'Notiz: maximal 5000 Zeichen.'});
      patch.notes = body.notes.trim();
    }
    if (body.scheduled_at !== undefined) {
      if (body.scheduled_at !== null && (typeof body.scheduled_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(body.scheduled_at) || !Number.isFinite(Date.parse(body.scheduled_at)))) return json(400,{ok:false,message:'Ungültiger Rückruftermin.'});
      patch.scheduled_at = body.scheduled_at;
      patch.schedule_manual = true;
    }
    const query = {...scope(tenant),call_id:'eq.'+body.call_id};
    const rows = await listRows('call_workspace',{...query,select:'call_id,state,updated_at',limit:1},{serviceRole:true});
    if (!rows.length || rows[0].state === 'deleted') return json(404,{ok:false,message:'Gespräch nicht gefunden.'});
    if (body.expected_updated_at && body.expected_updated_at !== rows[0].updated_at) return json(409,{ok:false,message:'Dieses Gespräch wurde inzwischen geändert. Bitte die Details schließen, aktualisieren und erneut öffnen.'});
    if (rows[0].updated_at) query.updated_at = 'eq.'+rows[0].updated_at;
    if (patch.state === 'deleted') Object.assign(patch,{snapshot:{},notes:'',scheduled_at:null,schedule_manual:true});
    const saved = await patchRows('call_workspace',query,patch,{serviceRole:true});
    if (!saved.length) return json(409,{ok:false,message:'Dieses Gespräch wurde inzwischen geändert. Bitte aktualisieren und erneut versuchen.'});
    const row = saved[0];
    return json(200,{ok:true,work:{state:row.state,state_manual:row.state_manual,notes:row.notes,scheduled_at:row.scheduled_at,schedule_manual:row.schedule_manual,updated_at:row.updated_at}});
  } catch(error) { return json(error.status || 500,{ok:false,message:error.message || 'Speichern fehlgeschlagen.'}); }
};
