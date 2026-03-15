-- =============================================================================
-- Migração: Remove breakdowns de placement de meta_daily_campaign_metrics
-- =============================================================================
-- Problema corrigido:
--   A ingestão anterior usava breakdowns (publisher_platform + platform_position
--   + device_platform), gerando N linhas por campanha/dia. O consolidate() somava
--   o reach de todas essas linhas, inflando o total (o mesmo usuário pode aparecer
--   em múltiplos placements).
--
-- O que esta migração faz:
--   1. Agrega as linhas existentes em uma única linha por (client_id, date,
--      campaign_name, project_tag), usando:
--        - SUM para métricas aditivas: spend, clicks, leads, landing_page_views
--        - SUM para impressions (aditivo por placement)
--        - MAX para reach (melhor aproximação disponível para dados históricos;
--          novos dados ingeridos sem breakdowns terão o valor correto da API)
--   2. Recria a tabela com a nova constraint única
--   3. Remove as colunas de breakdown (publisher_platform, platform_position,
--      device_platform) que não são mais utilizadas
--
-- Execute UMA VEZ no Supabase SQL Editor após fazer deploy do novo ingest.
-- É idempotente: pode ser rodado novamente sem efeito colateral.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------
-- Passo 1: Agrega dados existentes (elimina duplicatas por breakdown)
-- -----------------------------------------------------------------------
create temp table campaign_metrics_deduped as
select
  client_id,
  date,
  campaign_name,
  project_tag,
  max(reach)               as reach,   -- aproximação para dados históricos
  sum(impressions)         as impressions,
  sum(amount_spent)        as amount_spent,
  sum(link_clicks)         as link_clicks,
  sum(landing_page_views)  as landing_page_views,
  sum(leads)               as leads,
  max(account_name)        as account_name,
  min(created_at)          as created_at,
  max(updated_at)          as updated_at
from public.meta_daily_campaign_metrics
group by client_id, date, campaign_name, project_tag;

-- -----------------------------------------------------------------------
-- Passo 2: Limpa a tabela atual
-- -----------------------------------------------------------------------
truncate public.meta_daily_campaign_metrics;

-- -----------------------------------------------------------------------
-- Passo 3: Remove a constraint antiga (nome gerado automaticamente)
-- -----------------------------------------------------------------------
do $$
declare
  v_constraint text;
begin
  select constraint_name into v_constraint
  from information_schema.table_constraints
  where table_schema = 'public'
    and table_name   = 'meta_daily_campaign_metrics'
    and constraint_type = 'UNIQUE'
    and constraint_name not like '%pkey%'
  limit 1;

  if v_constraint is not null then
    execute 'alter table public.meta_daily_campaign_metrics drop constraint ' || quote_ident(v_constraint);
    raise notice 'Dropped constraint: %', v_constraint;
  else
    raise notice 'No unique constraint found to drop (already migrated?)';
  end if;
end $$;

-- -----------------------------------------------------------------------
-- Passo 4: Remove colunas de breakdown que não são mais utilizadas
-- -----------------------------------------------------------------------
alter table public.meta_daily_campaign_metrics
  drop column if exists publisher_platform,
  drop column if exists platform_position,
  drop column if exists device_platform;

-- -----------------------------------------------------------------------
-- Passo 5: Adiciona nova constraint única sem colunas de breakdown
-- -----------------------------------------------------------------------
alter table public.meta_daily_campaign_metrics
  add constraint meta_daily_campaign_metrics_client_date_campaign_tag_key
  unique (client_id, date, campaign_name, project_tag);

-- -----------------------------------------------------------------------
-- Passo 6: Reinsere dados agregados
-- -----------------------------------------------------------------------
insert into public.meta_daily_campaign_metrics
  (client_id, date, campaign_name, project_tag,
   reach, impressions, amount_spent, link_clicks,
   landing_page_views, leads, account_name,
   created_at, updated_at)
select
  client_id, date, campaign_name, project_tag,
  reach, impressions, amount_spent, link_clicks,
  landing_page_views, leads, account_name,
  created_at, updated_at
from campaign_metrics_deduped;

commit;

-- -----------------------------------------------------------------------
-- Verificação
-- -----------------------------------------------------------------------
select
  count(*) as total_rows,
  count(distinct (client_id, date, campaign_name, project_tag)) as unique_keys,
  case
    when count(*) = count(distinct (client_id, date, campaign_name, project_tag))
    then 'OK — sem duplicatas'
    else 'ERRO — ainda há duplicatas'
  end as status
from public.meta_daily_campaign_metrics;
