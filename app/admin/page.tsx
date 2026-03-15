import { redirect } from 'next/navigation'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { getSupabaseAdminClient } from '@/lib/supabase/admin'
import { createClientAction, setClientStatusAction } from './actions'

type AdminPageProps = {
  searchParams: Promise<{ error?: string; success?: string }>
}

const ERROR_MESSAGES: Record<string, string> = {
  missing_fields: 'Preencha todos os campos obrigatórios.',
  create_client_failed: 'Erro ao criar cliente no banco.',
  create_user_failed: 'Erro ao criar usuário no Auth. O email já pode estar em uso.',
  create_profile_failed: 'Erro ao criar perfil do usuário.',
  create_credentials_failed: 'Erro ao salvar token Meta.',
  create_account_failed: 'Erro ao salvar conta de anúncios.',
  invalid_client_id: 'ID de cliente inválido.',
  client_not_found: 'Cliente não encontrado.',
  client_inactive: 'Este cliente está inativo. Reative-o antes de visualizar.'
}

const SUCCESS_MESSAGES: Record<string, string> = {
  client_created: 'Cliente criado com sucesso.',
  client_deactivated: 'Cliente desativado.',
  client_reactivated: 'Cliente reativado.'
}

export default async function AdminPage({ searchParams }: AdminPageProps) {
  const params = await searchParams

  const supabase = await getSupabaseServerClient()
  const {
    data: { user }
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, full_name')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin') redirect('/dashboard')

  const admin = getSupabaseAdminClient()

  const [{ data: clients }, { data: profiles }, { data: adAccounts }, { data: authUsers }] =
    await Promise.all([
      admin.from('clients').select('id,name,status,created_at').order('created_at', { ascending: false }),
      admin.from('profiles').select('id,client_id,full_name,role'),
      admin.from('client_ad_accounts').select('client_id,ad_account_id,label,is_active'),
      admin.auth.admin.listUsers()
    ])

  const userEmailMap = new Map(
    (authUsers?.users || []).map((u) => [u.id, u.email || ''])
  )

  const clientsWithData = (clients || []).map((c) => ({
    ...c,
    users: (profiles || [])
      .filter((p) => p.client_id === c.id)
      .map((p) => ({ ...p, email: userEmailMap.get(p.id) || '' })),
    accounts: (adAccounts || []).filter((a) => a.client_id === c.id)
  }))

  const errorMsg = params.error ? (ERROR_MESSAGES[params.error] ?? 'Erro desconhecido.') : null
  const successMsg = params.success ? (SUCCESS_MESSAGES[params.success] ?? null) : null

  return (
    <main className="app-shell">
      <div className="ds-nav reveal d1">
        <div className="ds-nav-logo">
          <span className="ds-nav-logo-dot" />
          <span>Meta Client Hub</span>
        </div>
        <span className="ds-pill">Admin</span>
        <span className="ds-pill mono">{profile.full_name || user.email}</span>
        <div className="ds-nav-logout">
          <a href="/dashboard" className="button-secondary" style={{ padding: '6px 14px', borderRadius: 8, fontSize: 12 }}>
            ← Dashboard
          </a>
        </div>
      </div>

      <div className="page-wrap">
        <section className="hero reveal d2">
          <h1>Gerenciar Clientes</h1>
          <p>Cadastre novos clientes ou altere o status dos existentes.</p>
        </section>

        {errorMsg ? (
          <section className="panel reveal d3">
            <p className="error">{errorMsg}</p>
          </section>
        ) : null}

        {successMsg ? (
          <section className="panel reveal d3">
            <p style={{ color: '#4ade80', fontWeight: 600 }}>{successMsg}</p>
          </section>
        ) : null}

        {/* Novo cliente */}
        <section className="panel reveal d3">
          <h2>Novo Cliente</h2>
          <form action={createClientAction} className="filters" style={{ maxWidth: 640 }}>
            <div className="field">
              <label htmlFor="name">Nome do cliente *</label>
              <input id="name" name="name" placeholder="Ex: Empresa XYZ" required />
            </div>
            <div className="field">
              <label htmlFor="full_name">Nome do usuário</label>
              <input id="full_name" name="full_name" placeholder="Ex: João Silva" />
            </div>
            <div className="field">
              <label htmlFor="email">Email de acesso *</label>
              <input id="email" name="email" type="email" placeholder="cliente@empresa.com" required />
            </div>
            <div className="field">
              <label htmlFor="password">Senha inicial *</label>
              <input id="password" name="password" type="password" placeholder="Mínimo 6 caracteres" required />
            </div>
            <div className="field">
              <label htmlFor="access_token">Token Meta (Access Token) *</label>
              <input id="access_token" name="access_token" placeholder="EAAxxxxxxx..." required />
            </div>
            <div className="field">
              <label htmlFor="ad_account_id">ID da Conta de Anúncios *</label>
              <input id="ad_account_id" name="ad_account_id" placeholder="Ex: 123456789012345" required />
            </div>
            <div className="field">
              <label htmlFor="account_label">Label da conta</label>
              <input id="account_label" name="account_label" placeholder="Conta Principal" />
            </div>
            <div className="field filter-actions">
              <label>&nbsp;</label>
              <button className="button-custom" type="submit">
                <div className="points_wrapper" aria-hidden="true">
                  <i className="point" />
                  <i className="point" />
                  <i className="point" />
                  <i className="point" />
                </div>
                <span className="inner">Criar Cliente</span>
              </button>
            </div>
          </form>
        </section>

        {/* Lista de clientes */}
        <section className="panel reveal d4">
          <h2>Clientes ({clientsWithData.length})</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Status</th>
                  <th>Usuários</th>
                  <th>Contas de Anúncios</th>
                  <th>Criado em</th>
                  <th>Ação</th>
                </tr>
              </thead>
              <tbody>
                {clientsWithData.map((c) => (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td>
                      <span style={{
                        color: c.status === 'active' ? '#4ade80' : '#f87171',
                        fontWeight: 600,
                        fontSize: 12
                      }}>
                        {c.status === 'active' ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td>
                      {c.users.length === 0 ? (
                        <span style={{ color: 'var(--text-muted)' }}>—</span>
                      ) : (
                        c.users.map((u) => (
                          <div key={u.id} style={{ fontSize: 12 }}>
                            {u.email} <span style={{ color: 'var(--text-muted)' }}>({u.role})</span>
                          </div>
                        ))
                      )}
                    </td>
                    <td>
                      {c.accounts.length === 0 ? (
                        <span style={{ color: 'var(--text-muted)' }}>—</span>
                      ) : (
                        c.accounts.map((a) => (
                          <div key={a.ad_account_id} style={{ fontSize: 12 }}>
                            {a.label || a.ad_account_id}{' '}
                            <span style={{ color: 'var(--text-muted)' }}>({a.ad_account_id})</span>
                          </div>
                        ))
                      )}
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {new Date(c.created_at).toLocaleDateString('pt-BR')}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <a
                          href={`/dashboard?as=${c.id}`}
                          className="button-secondary"
                          style={{ fontSize: 12, padding: '4px 10px', textDecoration: 'none', borderRadius: 6 }}
                        >
                          👁 Ver
                        </a>
                        <form action={setClientStatusAction}>
                          <input type="hidden" name="client_id" value={c.id} />
                          <input
                            type="hidden"
                            name="status"
                            value={c.status === 'active' ? 'inactive' : 'active'}
                          />
                          <button
                            className="button-secondary"
                            type="submit"
                            style={{ fontSize: 12, padding: '4px 10px' }}
                          >
                            {c.status === 'active' ? 'Desativar' : 'Reativar'}
                          </button>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  )
}
