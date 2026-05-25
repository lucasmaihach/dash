-- Controle de última janela de ingestão por cliente
alter table if exists public.clients
  add column if not exists last_ingest_since date,
  add column if not exists last_ingest_until date,
  add column if not exists last_ingest_at timestamptz;

