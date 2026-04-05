import { redirect } from 'next/navigation'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { getSupabaseAdminClient } from '@/lib/supabase/admin'
import { createClientAction, refreshAllClientsAction, refreshClientAction, setClientStatusAction, saveGoogleCredentialsAction } from './actions'
import { SubmitButton } from '@/app/components/SubmitButton'

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
  client_inactive: 'Este cliente está inativo. Reative-o antes de visualizar.',
  refresh_all_failed: 'Não foi possível atualizar os dados de todos os clientes.',
  refresh_client_failed: 'Não foi possível atualizar os dados deste cliente.',
  create_client_sync_failed: 'Cliente criado, mas a ingestão automática inicial falhou. Clique em "Atualizar dados" para tentar novamente.',
  google_missing_fields: 'Preencha Cliente, Refresh Token e Customer ID do Google.',
  google_credentials_failed: 'Erro ao salvar credenciais Google.',
  google_account_failed: 'Erro ao salvar conta Google Ads.',
}

const SUCCESS_MESSAGES: Record<string, string> = {
  client_created: 'Cliente criado com sucesso.',
  client_created_and_synced: 'Cliente criado e dados ingeridos com sucesso.',
  client_deactivated: 'Cliente desativado.',
  client_reactivated: 'Cliente reativado.',
  refresh_all_done: 'Atualização de dados concluída para todos os clientes ativos.',
  refresh_client_done: 'Atualização de dados concluída para o cliente.',
  google_credentials_saved: 'Credenciais Google salvas com sucesso.',
}

export default async function AdminPage({ searchParams }: AdminPageProps) {
  const params = await searchParams

  const supabase = await getSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, full_name')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin') redirect('/dashboard')

  const admin = getSupabaseAdminClient()

  const [{ data: clients }, { data: profiles }, { data: adAccounts }, { data: googleCreds }, { data: authUsers }] =
    await Promise.all([
      admin.from('clients').select('id,name,status,created_at').order('created_at', { ascending: false }),
      admin.from('profiles').select('id,client_id,full_name,role'),
      admin.from('client_ad_accounts').select('client_id,ad_account_id,label,is_active'),
      admin.from('client_google_credentials').select('client_id,is_active'),
      admin.auth.admin.listUsers()
    ])

  const userEmailMap = new Map((authUsers?.users || []).map((u) => [u.id, u.email || '']))
  const googleClientIds = new Set((googleCreds || []).filter(g => g.is_active).map(g => g.client_id))

  const clientsWithData = (clients || []).map((c) => ({
    ...c,
    users: (profiles || []).filter((p) => p.client_id === c.id).map((p) => ({ ...p, email: userEmailMap.get(p.id) || '' })),
    accounts: (adAccounts || []).filter((a) => a.client_id === c.id),
    hasGoogle: googleClientIds.has(c.id),
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
          <p>Cadastre novos clientes ou gerencie os existentes.</p>
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

        <section className="panel reveal d3">
          <h2>Novo Cliente</h2>
          <p className="admin-intro-copy">
            Fluxo recomendado: crie o cliente com Meta Ads primeiro e, se necessário, conecte Google Ads em seguida.
          </p>

          <div className="admin-onboarding-grid">
            <form action={createClientAction} className="admin-card admin-card-primary">
              <div className="admin-card-header">
                <h3>Criar Cliente</h3>
                <p>Cadastro inicial com credenciais obrigatórias da Meta para começar a ingestão.</p>
              </div>

              <div className="admin-form-section">
                <div className="admin-section-title-row">
                  <p className="admin-section-label">Dados do Cliente</p>
                </div>
                <div className="admin-fields-grid">
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
                </div>
              </div>

              <div className="admin-form-section">
                <div className="admin-section-title-row">
                  <p className="admin-section-label admin-label-meta">Meta Ads</p>
                  <span className="admin-section-pill">Obrigatório</span>
                </div>
                <div className="admin-fields-grid">
                  <div className="field admin-field-full">
                    <label htmlFor="access_token">Access Token *</label>
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
                </div>
              </div>

              <p className="admin-inline-note">
                Google Ads é opcional e pode ser vinculado no card ao lado sem impactar o cadastro inicial.
              </p>

              <div className="admin-submit-row">
                <SubmitButton className="button-custom" label="Criar Cliente" pendingLabel="Criando + sincronizando dados..." />
              </div>
            </form>

            <aside className="admin-card admin-card-secondary">
              <div className="admin-card-header">
                <h3>Google Ads</h3>
                <p>Use este bloco quando o cliente já existir e você quiser habilitar os dados de Google Ads.</p>
              </div>

              <div className="admin-side-helper">
                <p>1. Selecione o cliente.</p>
                <p>2. Cole o refresh token.</p>
                <p>3. Informe o Customer ID e salve.</p>
              </div>

              <details className="admin-collapsible" open>
                <summary>Vincular Google Ads a Cliente Existente</summary>
                <form action={saveGoogleCredentialsAction} className="admin-collapsible-body">
                  <div className="admin-fields-grid">
                    <div className="field admin-field-full">
                      <label htmlFor="g_client_id">Cliente *</label>
                      <select id="g_client_id" name="client_id" required>
                        <option value="">Selecione o cliente...</option>
                        {(clients || []).map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="field admin-field-full">
                      <label htmlFor="g_refresh_token">Refresh Token OAuth2 *</label>
                      <input id="g_refresh_token" name="refresh_token" placeholder="1//04gn6r_NQAI6fCg..." required />
                    </div>
                    <div className="field">
                      <label htmlFor="g_customer_id">Customer ID *</label>
                      <input id="g_customer_id" name="customer_id" placeholder="Ex: 123-456-7890" required />
                    </div>
                    <div className="field">
                      <label htmlFor="g_manager_id">Manager ID (opcional)</label>
                      <input id="g_manager_id" name="manager_customer_id" placeholder="Ex: 403-407-1393" />
                    </div>
                  </div>
                  <SubmitButton className="button-custom" label="Salvar Credenciais Google" pendingLabel="Salvando..." />
                </form>
              </details>
            </aside>
          </div>
        </section>

        {/* Lista de Clientes */}
        <section className="panel reveal d4">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <h2 style={{ margin: 0 }}>Clientes ({clientsWithData.length})</h2>
            <form action={refreshAllClientsAction}>
              <SubmitButton
                label="↻ Atualizar todos"
                pendingLabel="Atualizando..."
                className="button-secondary"
                style={{ fontSize: 12, padding: '6px 14px' }}
              />
            </form>
          </div>

          <div className="admin-clients-grid">
            {clientsWithData.map((c) => (
              <div key={c.id} className="admin-client-card" style={{
                background: 'var(--bg-card, rgba(255,255,255,0.04))',
                border: '1px solid var(--border)',
                borderRadius: 12,
                padding: '16px 20px',
              }}>
                {/* Linha superior: nome + status + badges */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <span style={{ fontWeight: 700, fontSize: 15 }}>{c.name}</span>
                  <span style={{
                    fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20,
                    background: c.status === 'active' ? 'rgba(74,222,128,0.12)' : 'rgba(248,113,113,0.12)',
                    color: c.status === 'active' ? '#4ade80' : '#f87171',
                  }}>
                    {c.status === 'active' ? 'Ativo' : 'Inativo'}
                  </span>
                  <span style={{
                    fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20,
                    background: 'rgba(24,119,242,0.12)', color: '#4a9ff5',
                  }}>
                    Meta
                  </span>
                  {c.hasGoogle ? (
                    <span style={{
                      fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20,
                      background: 'rgba(52,168,83,0.12)', color: '#34a853',
                    }}>
                      Google
                    </span>
                  ) : null}
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
                    {new Date(c.created_at).toLocaleDateString('pt-BR')}
                  </span>
                </div>

                {/* Info: usuários + contas */}
                <div className="admin-client-meta" style={{ display: 'flex', gap: 24, marginBottom: 14, fontSize: 12, color: 'var(--text-muted)' }}>
                  <div>
                    <span style={{ fontWeight: 600 }}>Usuários: </span>
                    {c.users.length === 0 ? '—' : c.users.map((u) => (
                      <span key={u.id}>{u.email} ({u.role})</span>
                    ))}
                  </div>
                  <div>
                    <span style={{ fontWeight: 600 }}>Contas Meta: </span>
                    {c.accounts.length === 0 ? '—' : c.accounts.map((a) => (
                      <span key={a.ad_account_id}>{a.label || 'Conta'} ({a.ad_account_id})</span>
                    ))}
                  </div>
                </div>

                {/* Ações */}
                <div className="admin-client-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <a
                    href={`/dashboard?as=${c.id}`}
                    className="button-secondary"
                    style={{ fontSize: 12, padding: '5px 12px', textDecoration: 'none', borderRadius: 8 }}
                  >
                    Ver dashboard
                  </a>
                  <form action={refreshClientAction}>
                    <input type="hidden" name="client_id" value={c.id} />
                    <SubmitButton
                      label="↻ Atualizar dados"
                      pendingLabel="Atualizando..."
                      className="button-secondary"
                      style={{ fontSize: 12, padding: '5px 12px', borderRadius: 8 }}
                    />
                  </form>
                  <form action={setClientStatusAction}>
                    <input type="hidden" name="client_id" value={c.id} />
                    <input type="hidden" name="status" value={c.status === 'active' ? 'inactive' : 'active'} />
                    <button className="button-secondary" type="submit" style={{ fontSize: 12, padding: '5px 12px', borderRadius: 8, color: c.status === 'active' ? '#f87171' : '#4ade80' }}>
                      {c.status === 'active' ? 'Desativar' : 'Reativar'}
                    </button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        </section>

      </div>
    </main>
  )
}
