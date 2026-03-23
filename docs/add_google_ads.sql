


-- Google Ads: credenciais, contas e métricas diárias (campaign + ad)
-- Execute no SQL Editor do Supabase.

-- Reaproveita trigger helper já usada no projeto
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =====================================================
-- 1) Credenciais Google por cliente
-- =====================================================
-- Refresh token fica criptografado em repouso (mesma estratégia do Meta).
create table if not exists public.client_google_credentials (
  client_id uuid primary key references public.clients (id) on delete cascade,
  refresh_token text not null,
  manager_customer_id text,
  is_active boolean not null default true,
  updated_at timestamptz not null default now()
);

-- Contas Google Ads por cliente (um cliente pode ter múltiplas contas)
create table if not exists public.client_google_ad_accounts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  customer_id text not null,
  label text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (client_id, customer_id)
);

create index if not exists idx_google_accounts_client
  on public.client_google_ad_accounts (client_id, is_active);

-- =====================================================
-- 2) Métricas diárias por campanha (Google)
-- =====================================================
create table if not exists public.google_daily_campaign_metrics (
  id bigint generated always as identity primary key,
  client_id uuid not null references public.clients (id) on delete cascade,
  date date not null,
  campaign_id text,
  campaign_name text not null,
  project_tag text not null default 'Sem Tag',
  impressions numeric not null default 0,
  clicks numeric not null default 0,
  amount_spent numeric not null default 0,
  conversions numeric not null default 0,
  leads numeric not null default 0,
  account_name text,
  customer_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, date, campaign_id)
);

create index if not exists idx_google_campaign_metrics_client_date
  on public.google_daily_campaign_metrics (client_id, date);

create index if not exists idx_google_campaign_metrics_client_tag_date
  on public.google_daily_campaign_metrics (client_id, project_tag, date);

create index if not exists idx_google_campaign_metrics_client_campaign_date
  on public.google_daily_campaign_metrics (client_id, campaign_name, date);

-- Compatibilidade para bases antigas
alter table public.google_daily_campaign_metrics
  add column if not exists campaign_id text,
  add column if not exists project_tag text,
  add column if not exists clicks numeric not null default 0,
  add column if not exists conversions numeric not null default 0,
  add column if not exists leads numeric not null default 0,
  add column if not exists customer_id text,
  add column if not exists account_name text;

update public.google_daily_campaign_metrics
set project_tag = coalesce(project_tag, 'Sem Tag')
where project_tag is null;

drop trigger if exists trg_google_campaign_metrics_set_updated_at on public.google_daily_campaign_metrics;
create trigger trg_google_campaign_metrics_set_updated_at
before update on public.google_daily_campaign_metrics
for each row execute function public.set_updated_at();

-- =====================================================
-- 3) Métricas diárias por anúncio (Google)
-- =====================================================
create table if not exists public.google_daily_ad_metrics (
  id bigint generated always as identity primary key,
  client_id uuid not null references public.clients (id) on delete cascade,
  date date not null,
  campaign_id text,
  campaign_name text not null,
  project_tag text not null default 'Sem Tag',
  ad_group_id text,
  ad_group_name text,
  ad_id text,
  ad_name text,
  impressions numeric not null default 0,
  clicks numeric not null default 0,
  amount_spent numeric not null default 0,
  conversions numeric not null default 0,
  leads numeric not null default 0,
  customer_id text,
  account_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, date, ad_id)
);

create index if not exists idx_google_ad_metrics_client_date
  on public.google_daily_ad_metrics (client_id, date);

create index if not exists idx_google_ad_metrics_client_tag_date
  on public.google_daily_ad_metrics (client_id, project_tag, date);

create index if not exists idx_google_ad_metrics_client_ad_name
  on public.google_daily_ad_metrics (client_id, ad_name);

-- Compatibilidade para bases antigas
alter table public.google_daily_ad_metrics
  add column if not exists campaign_id text,
  add column if not exists project_tag text,
  add column if not exists ad_group_id text,
  add column if not exists ad_group_name text,
  add column if not exists ad_name text,
  add column if not exists clicks numeric not null default 0,
  add column if not exists conversions numeric not null default 0,
  add column if not exists leads numeric not null default 0,
  add column if not exists customer_id text,
  add column if not exists account_name text;

update public.google_daily_ad_metrics
set project_tag = coalesce(project_tag, 'Sem Tag')
where project_tag is null;

drop trigger if exists trg_google_ad_metrics_set_updated_at on public.google_daily_ad_metrics;
create trigger trg_google_ad_metrics_set_updated_at
before update on public.google_daily_ad_metrics
for each row execute function public.set_updated_at();

-- =====================================================
-- 4) RLS (mesmo padrão do Meta)
-- =====================================================
alter table public.client_google_credentials enable row level security;
alter table public.client_google_ad_accounts enable row level security;
alter table public.google_daily_campaign_metrics enable row level security;
alter table public.google_daily_ad_metrics enable row level security;

-- Credentials: somente service role
-- (drop policy para permitir re-execução idempotente)
drop policy if exists "google_credentials_service_role_all" on public.client_google_credentials;
create policy "google_credentials_service_role_all"
on public.client_google_credentials
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

-- Accounts: leitura do próprio client + escrita via service role
drop policy if exists "google_accounts_select_same_client" on public.client_google_ad_accounts;
create policy "google_accounts_select_same_client"
on public.client_google_ad_accounts
for select
using (
  client_id in (
    select p.client_id
    from public.profiles p
    where p.id = auth.uid()
  )
);

drop policy if exists "google_accounts_service_role_all" on public.client_google_ad_accounts;
create policy "google_accounts_service_role_all"
on public.client_google_ad_accounts
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

-- Campaign metrics: leitura do próprio client + escrita via service role
drop policy if exists "google_campaign_metrics_select_same_client" on public.google_daily_campaign_metrics;
create policy "google_campaign_metrics_select_same_client"
on public.google_daily_campaign_metrics
for select
using (
  client_id in (
    select p.client_id
    from public.profiles p
    where p.id = auth.uid()
  )
);

drop policy if exists "google_campaign_metrics_service_role_all" on public.google_daily_campaign_metrics;
create policy "google_campaign_metrics_service_role_all"
on public.google_daily_campaign_metrics
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

-- Ad metrics: leitura do próprio client + escrita via service role
drop policy if exists "google_ad_metrics_select_same_client" on public.google_daily_ad_metrics;
create policy "google_ad_metrics_select_same_client"
on public.google_daily_ad_metrics
for select
using (
  client_id in (
    select p.client_id
    from public.profiles p
    where p.id = auth.uid()
  )
);

drop policy if exists "google_ad_metrics_service_role_all" on public.google_daily_ad_metrics;
create policy "google_ad_metrics_service_role_all"
on public.google_daily_ad_metrics
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');
