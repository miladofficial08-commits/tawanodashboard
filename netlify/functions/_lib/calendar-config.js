function isTawanoTenant(tenant) {
  const source = tenant || {};
  return /tavano|tawano/.test([source.id, source.slug, source.name].map((v) => String(v || '').toLowerCase()).join(' '));
}

function selectCalendarConfig(options) {
  const input = options || {};
  const settings = input.settings || {};
  const canUseGlobalFallback = isTawanoTenant(input.tenant);
  return {
    bookingEnabled: settings.booking_enabled === true,
    apiKey: String(settings.calcom_api_key || (canUseGlobalFallback ? input.globalApiKey : '') || '').trim(),
    eventTypeId: String(settings.calcom_event_type_id || (canUseGlobalFallback ? input.globalEventTypeId : '') || '').trim(),
  };
}

module.exports = { isTawanoTenant, selectCalendarConfig };
