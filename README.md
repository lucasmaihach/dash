# Multi-Client Meta Dashboard (Next.js + Supabase)

Primeira versao pronta para `app.seudominio.com` com:

- Login via Supabase Auth
- Isolamento de dados por `client_id`
- Dashboard por produto com abas e filtros por TAG/nome
- Visões: Executivo, Consolidado por dia, Melhores anúncios, Melhores conjuntos
- Design system dark aplicado
- Ingestao multi-cliente da Meta API para Supabase

## Stack

- Next.js 15 (App Router)
- TypeScript
- Supabase (`@supabase/ssr`, `@supabase/supabase-js`)

## Estrutura

- `app/login`: tela de login
- `app/dashboard`: dashboard executivo
- `app/dashboard/actions.ts`: criação de relatórios de produto salvos
- `middleware.ts`: proteção de rota e sessão
- `docs/multi_tenant_schema.sql`: schema multi-cliente + RLS
- `scripts/ingest_meta_to_supabase.mjs`: coleta Meta e upsert no Supabase

## Setup local

1. Instale dependências:

```bash
npm install
```

2. Configure variáveis:

```bash
cp .env.example .env.local
```

3. Rode o SQL em `docs/multi_tenant_schema.sql` no Supabase.

4. Cadastre dados base no banco:

- 1+ registros em `clients`
- 1+ usuários no Supabase Auth
- `profiles` ligando `auth.users.id -> client_id`
- `client_ad_accounts` com contas por cliente
- `client_meta_credentials` com token de cada cliente

5. Rode ingestão para popular métricas de campanha e anúncio:

```bash
npm run ingest:meta
```

6. Suba a aplicação:

```bash
npm run dev
```

## Como acessar o dashboard (primeira versão)

- Local: `http://localhost:3000`
- Você será redirecionado para `/login`
- Faça login com usuário que exista em `profiles`
- Após login: `/dashboard`

## Produção (URL)

- Deploy recomendado: Vercel
- URL alvo: `app.seudominio.com`
- Todos os clientes no mesmo deploy
- Isolamento por `client_id` via RLS

## Ingestão automática

Você pode agendar:

```bash
*/15 * * * * cd /caminho/do/projeto && npm run ingest:meta >> ingest.log 2>&1
```

## Relatórios por produto (novo)

- Crie um relatório salvo em `Dashboard > Relatórios de Produto` com:
- `Nome do relatório`
- `TAG base`
- `Filtro inicial de campanha` (opcional)
- O relatório fica salvo no Supabase e outros usuários do mesmo `client_id` enxergam.

## Observações de segurança

- `client_meta_credentials.access_token` está em texto na MVP. Para produção, use criptografia em repouso (pgcrypto/KMS).
- Nunca exponha `SUPABASE_SERVICE_ROLE_KEY` no frontend.
