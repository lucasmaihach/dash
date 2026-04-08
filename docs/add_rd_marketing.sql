create table if not exists public.client_rd_credentials (
  client_id uuid primary key references public.clients (id) on delete cascade,
  access_token text not null,
  refresh_token text not null,
  expires_in integer,
  is_active boolean not null default true,
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_rd_credentials_set_updated_at on public.client_rd_credentials;
create trigger trg_rd_credentials_set_updated_at
before update on public.client_rd_credentials
for each row execute function public.set_updated_at();

alter table public.client_rd_credentials enable row level security;

drop policy if exists "rd_credentials_service_role_all" on public.client_rd_credentials;
create policy "rd_credentials_service_role_all"
on public.client_rd_credentials
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

