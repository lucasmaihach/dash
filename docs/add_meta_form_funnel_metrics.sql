-- Adiciona métricas de funil de formulário (Meta) para campanhas e anúncios
-- e chaves opcionais por cliente para action types customizados.

alter table if exists public.clients
  add column if not exists form_view_action_key text,
  add column if not exists form_start_action_key text,
  add column if not exists form_submit_action_key text;

alter table if exists public.meta_daily_campaign_metrics
  add column if not exists view_forms numeric not null default 0,
  add column if not exists form_starts numeric not null default 0,
  add column if not exists form_submits numeric not null default 0;

alter table if exists public.meta_daily_ad_metrics
  add column if not exists view_forms numeric not null default 0,
  add column if not exists form_starts numeric not null default 0,
  add column if not exists form_submits numeric not null default 0;
