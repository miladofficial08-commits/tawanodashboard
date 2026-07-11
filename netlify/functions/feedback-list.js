const { bearerTokenFromEvent, json, listRows, resolveTenantContextFromAccessToken } = require('./_lib/tenant');

exports.handler = async (event) => {
  if ((event.httpMethod || 'GET').toUpperCase() !== 'GET') return json(405, { ok: false });
  const token = bearerTokenFromEvent(event);
  if (!token) return json(401, { ok: false, message: 'Unauthorized' });
  try {
    const context = await resolveTenantContextFromAccessToken(token);
    let feedback;
    try {
      feedback = await listRows('sms_feedback', {
        select: 'id,phone_number,rating,message,call_id,created_at',
        tenant_id: 'eq.' + context.tenant.id, order: 'created_at.desc', limit: 200,
      }, { serviceRole: true });
    } catch (_) {
      const snapshots = await listRows('analytics_snapshots', {
        select: 'id,payload,created_at', tenant_id: 'eq.' + context.tenant.id,
        snapshot_type: 'eq.sms_feedback', order: 'created_at.desc', limit: 200,
      }, { serviceRole: true });
      feedback = snapshots.map((row) => Object.assign({ id: row.id, created_at: row.created_at }, row.payload || {}));
    }
    return json(200, { ok: true, feedback });
  } catch (error) {
    return json(500, { ok: false, message: 'Feedback konnte nicht geladen werden.', detail: String(error.message || error) });
  }
};
