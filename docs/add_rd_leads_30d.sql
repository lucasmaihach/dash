create table if not exists public.rd_leads_30d (
  id bigint generated always as identity primary key,
  client_id uuid not null references public.clients (id) on delete cascade,
  rd_contact_uuid text not null,
  email text,
  name text,
  created_at_rd timestamptz,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  budget_value numeric,
  is_mql_25k boolean not null default false,
  imported_at timestamptz not null default now(),
  unique (client_id, rd_contact_uuid)
);

create index if not exists idx_rd_leads_30d_client_created
  on public.rd_leads_30d (client_id, created_at_rd desc);

create index if not exists idx_rd_leads_30d_client_mql
  on public.rd_leads_30d (client_id, is_mql_25k);

alter table public.rd_leads_30d enable row level security;

drop policy if exists "rd_leads_service_role_all" on public.rd_leads_30d;
create policy "rd_leads_service_role_all"
on public.rd_leads_30d
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

drop policy if exists "rd_leads_select_same_client" on public.rd_leads_30d;
create policy "rd_leads_select_same_client"
on public.rd_leads_30d
for select
using (
  client_id in (
    select p.client_id
    from public.profiles p
    where p.id = auth.uid()
  )
);

