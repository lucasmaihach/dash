-- Adiciona suporte a métrica de mensagens separada de leads (Meta)

alter table if exists public.clients
  add column if not exists message_action_key text;

alter table if exists public.meta_daily_campaign_metrics
  add column if not exists messages numeric not null default 0;

alter table if exists public.meta_daily_ad_metrics
  add column if not exists messages numeric not null default 0;

