-- Tabela para armazenar dados de criativos dos anúncios
create table if not exists public.meta_ad_creatives (
  id bigint generated always as identity primary key,
  client_id uuid not null references public.clients (id) on delete cascade,
  ad_id text not null,
  ad_name text,
  campaign_id text,
  campaign_name text,
  adset_id text,
  adset_name text,
  creative_id text,
  image_url text,
  thumbnail_url text,
  video_url text,
  video_id text,
  link_url text,
  ad_snapshot_url text,
  call_to_action_type text,
  creative_type text not null default 'unknown',
  status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, ad_id)
);

create index if not exists idx_ad_creatives_client
  on public.meta_ad_creatives (client_id);

create index if not exists idx_ad_creatives_client_ad_id
  on public.meta_ad_creatives (client_id, ad_id);

-- Compatibilidade para bases já existentes
alter table public.meta_ad_creatives
  add column if not exists ad_snapshot_url text;

-- Auto updated_at trigger
drop trigger if exists trg_ad_creatives_set_updated_at on public.meta_ad_creatives;
create trigger trg_ad_creatives_set_updated_at
before update on public.meta_ad_creatives
for each row execute function public.set_updated_at();

-- RLS
alter table public.meta_ad_creatives enable row level security;

-- User can read only creatitives from own client_id
drop policy if exists "ad_creatives_select_same_client" on public.meta_ad_creatives;
create policy "ad_creatives_select_same_client"
on public.meta_ad_creatives
for select
using (
  client_id in (
    select p.client_id
    from public.profiles p
    where p.id = auth.uid()
  )
);

-- Service role can ingest anything
drop policy if exists "ad_creatives_service_role_all" on public.meta_ad_creatives;
create policy "ad_creatives_service_role_all"
on public.meta_ad_creatives
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');
