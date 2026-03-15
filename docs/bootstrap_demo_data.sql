-- 1) Cliente
insert into public.clients (name)
values ('Cliente Demo')
on conflict do nothing;

-- 2) Vincular usuario auth -> client_id (troque o email)
insert into public.profiles (id, client_id, full_name, role)
select
  u.id,
  c.id,
  'Usuario Demo',
  'viewer'
from auth.users u
join public.clients c on c.name = 'Cliente Demo'
where u.email = 'demo@cliente.com'
on conflict (id) do update set
  client_id = excluded.client_id,
  full_name = excluded.full_name,
  role = excluded.role;

-- 3) Token Meta do cliente (troque o token)
insert into public.client_meta_credentials (client_id, access_token, is_active)
select c.id, 'SEU_META_ACCESS_TOKEN', true
from public.clients c
where c.name = 'Cliente Demo'
on conflict (client_id) do update set
  access_token = excluded.access_token,
  is_active = excluded.is_active,
  updated_at = now();

-- 4) Conta de anuncios (troque a conta)
insert into public.client_ad_accounts (client_id, ad_account_id, label, is_active)
select c.id, '733515845637169', 'Conta Principal', true
from public.clients c
where c.name = 'Cliente Demo'
on conflict (client_id, ad_account_id) do update set
  label = excluded.label,
  is_active = excluded.is_active;
