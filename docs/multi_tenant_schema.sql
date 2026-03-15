-- Extensions
create extension if not exists "pgcrypto";

-- Clients
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

-- Profile linked to auth.users and client_id
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  full_name text,
  role text not null default 'viewer',
  created_at timestamptz not null default now()
);

-- Optional metadata about accounts by client
create table if not exists public.client_ad_accounts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  ad_account_id text not null,
  label text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (client_id, ad_account_id)
);

-- Active Meta token per client (MVP)
create table if not exists public.client_meta_credentials (
  client_id uuid primary key references public.clients (id) on delete cascade,
  access_token text not null,
  is_active boolean not null default true,
  updated_at timestamptz not null default now()
);

-- Daily metrics table consumed by dashboard
-- Uma linha por (client_id, date, campaign_name, project_tag) — sem breakdowns de placement.
-- Breakdowns inflariam reach/impressions pois o mesmo usuário seria contado por placement.
create table if not exists public.meta_daily_campaign_metrics (
  id bigint generated always as identity primary key,
  client_id uuid not null references public.clients (id) on delete cascade,
  date date not null,
  campaign_name text not null,
  project_tag text not null,
  reach numeric not null default 0,
  impressions numeric not null default 0,
  amount_spent numeric not null default 0,
  link_clicks numeric not null default 0,
  landing_page_views numeric not null default 0,
  leads numeric not null default 0,
  account_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, date, campaign_name, project_tag)
);

create index if not exists idx_metrics_client_date
  on public.meta_daily_campaign_metrics (client_id, date);
create index if not exists idx_metrics_client_tag_date
  on public.meta_daily_campaign_metrics (client_id, project_tag, date);

-- Auto updated_at
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_metrics_set_updated_at on public.meta_daily_campaign_metrics;
create trigger trg_metrics_set_updated_at
before update on public.meta_daily_campaign_metrics
for each row execute function public.set_updated_at();

-- RLS
alter table public.profiles enable row level security;
alter table public.meta_daily_campaign_metrics enable row level security;
alter table public.client_meta_credentials enable row level security;

-- User can read own profile
create policy "profile_select_own"
on public.profiles
for select
using (id = auth.uid());

-- User can read only rows from own client_id
create policy "metrics_select_same_client"
on public.meta_daily_campaign_metrics
for select
using (
  client_id in (
    select p.client_id
    from public.profiles p
    where p.id = auth.uid()
  )
);

-- Service role can ingest anything (for server-side jobs)
create policy "metrics_service_role_all"
on public.meta_daily_campaign_metrics
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

-- Credentials only by service role (ingestion worker)
create policy "client_credentials_service_role_all"
on public.client_meta_credentials
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

-- Saved product reports per client
create table if not exists public.product_reports (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  name text not null,
  tag_filter text not null,
  campaign_filter text,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists idx_product_reports_client_created
  on public.product_reports (client_id, created_at);

-- Ad-level metrics for best ad / best adset views
create table if not exists public.meta_daily_ad_metrics (
  id bigint generated always as identity primary key,
  client_id uuid not null references public.clients (id) on delete cascade,
  date date not null,
  campaign_name text not null,
  project_tag text not null,
  adset_id text,
  adset_name text,
  ad_id text,
  ad_name text,
  reach numeric not null default 0,
  impressions numeric not null default 0,
  amount_spent numeric not null default 0,
  link_clicks numeric not null default 0,
  landing_page_views numeric not null default 0,
  leads numeric not null default 0,
  account_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, date, ad_id)
);

create index if not exists idx_ad_metrics_client_date
  on public.meta_daily_ad_metrics (client_id, date);
create index if not exists idx_ad_metrics_client_tag_date
  on public.meta_daily_ad_metrics (client_id, project_tag, date);

drop trigger if exists trg_ad_metrics_set_updated_at on public.meta_daily_ad_metrics;
create trigger trg_ad_metrics_set_updated_at
before update on public.meta_daily_ad_metrics
for each row execute function public.set_updated_at();

alter table public.product_reports enable row level security;
alter table public.meta_daily_ad_metrics enable row level security;

drop policy if exists "ad_metrics_select_same_client" on public.meta_daily_ad_metrics;
create policy "ad_metrics_select_same_client"
on public.meta_daily_ad_metrics
for select
using (
  client_id in (
    select p.client_id
    from public.profiles p
    where p.id = auth.uid()
  )
);

drop policy if exists "ad_metrics_service_role_all" on public.meta_daily_ad_metrics;
create policy "ad_metrics_service_role_all"
on public.meta_daily_ad_metrics
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

drop policy if exists "product_reports_select_same_client" on public.product_reports;
create policy "product_reports_select_same_client"
on public.product_reports
for select
using (
  client_id in (
    select p.client_id
    from public.profiles p
    where p.id = auth.uid()
  )
);

drop policy if exists "product_reports_insert_same_client" on public.product_reports;
create policy "product_reports_insert_same_client"
on public.product_reports
for insert
with check (
  client_id in (
    select p.client_id
    from public.profiles p
    where p.id = auth.uid()
  )
  and created_by = auth.uid()
);

drop policy if exists "product_reports_delete_same_client" on public.product_reports;
create policy "product_reports_delete_same_client"
on public.product_reports
for delete
using (
  client_id in (
    select p.client_id
    from public.profiles p
    where p.id = auth.uid()
  )
);
