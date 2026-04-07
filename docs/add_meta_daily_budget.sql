-- Adiciona orçamento diário das campanhas Meta na tabela consumida pelo dashboard.
-- Execute no Supabase SQL Editor.

alter table if exists public.meta_daily_campaign_metrics
  add column if not exists daily_budget numeric not null default 0;

