# Quick Start Checklist

1. Rodar schema:
- Execute `docs/multi_tenant_schema.sql` no SQL Editor do Supabase.

2. Criar usuario no Auth:
- Email: `demo@cliente.com`
- Senha: escolha no painel Auth > Users.

3. Rodar dados iniciais:
- Execute `docs/bootstrap_demo_data.sql` no SQL Editor.
- Antes, troque token e conta de anuncios no arquivo.

4. Configurar ambiente local:
- Edite `.env.local` e preencha:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`

5. Ingestao da Meta:
- Rode `npm run ingest:meta`.

6. Subir dashboard:
- Rode `npm run dev`.
- Acesse `http://localhost:3000`.
