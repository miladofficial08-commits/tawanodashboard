-- Einmalig im Supabase SQL-Editor ausfuehren.
-- Grund: SMS-Inhalte kommen jetzt AUSSCHLIESSLICH aus Supabase. Tawano hatte
-- Absender + Buchungslink bisher nur hartcodiert im Code -> hier in Supabase nachziehen,
-- sonst kann Tawano nach dem Deploy keine SMS mehr senden ("no_sender").

-- 1) Absender + Buchungslink am Tenant setzen
update public.tenants
set sms_sender      = 'Tawano',
    booking_link_url = 'https://tawanodashboard.netlify.app/tavano-demo'
where id = 'tenant_tawano';

-- 2) Lead-Parameter an den Link anhaengen (Demo-/Lead-Capture-Seite).
--    Neuer Settings-Snapshot; die bestehende sms_template bleibt erhalten.
insert into public.analytics_snapshots (tenant_id, snapshot_type, payload)
select 'tenant_tawano', 'tenant_settings',
       coalesce(payload, '{}'::jsonb) || '{"append_lead_params": true}'::jsonb
from public.analytics_snapshots
where tenant_id = 'tenant_tawano' and snapshot_type = 'tenant_settings'
order by created_at desc
limit 1;

-- Alternativ/zukuenftig: alles bequem im Admin-Panel (/admin) pro Kunde editierbar
--   -> SMS-Nachricht, SMS-Absender, Buchungslink, "Lead-Infos anhaengen" (Checkbox).
