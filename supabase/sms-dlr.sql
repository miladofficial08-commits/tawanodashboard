-- Delivery-Report-Tracking fuer sms_logs (seven.io DLR-Webhook).
-- Einmal im Supabase SQL Editor ausfuehren.
--
-- Ablauf der Status-Werte in sms_logs.status:
--   ACCEPTED    -> seven.io hat die SMS angenommen (HTTP 200 / Code 100). NICHT zugestellt!
--   TRANSMITTED -> ans Mobilfunknetz uebergeben
--   BUFFERED    -> im Netz zwischengespeichert
--   DELIVERED   -> zugestellt (Endzustand, Erfolg)
--   NOTDELIVERED / REJECTED / EXPIRED / FAILED -> Zustellung fehlgeschlagen (Endzustand)

alter table public.sms_logs
  add column if not exists dlr_status     text,          -- letzter roher DLR-Status von seven.io
  add column if not exists error_code     text,          -- Fehlercode bei NOTDELIVERED/REJECTED/...
  add column if not exists delivered_at   timestamptz,   -- Zeitpunkt der Zustellung (nur bei DELIVERED)
  add column if not exists dlr_updated_at timestamptz;    -- Zeitpunkt des letzten DLR-Updates

-- Der DLR-Webhook findet die SMS ueber die seven.io message_id.
create index if not exists idx_sms_logs_provider_message_id
  on public.sms_logs(provider_message_id);
