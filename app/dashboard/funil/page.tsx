import { getSupabaseAdminClient } from '@/lib/supabase/admin'
import { resolveEffectiveClient } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// Página exclusiva da Gold Media / AKRO — funil comercial (Calendly + Fathom + ClickUp).
// Isolada de qualquer lógica usada pelos clientes do dashboard.
const AGENCIA_CLIENT_ID = 'b8724c80-9c00-48ce-b9e4-245ba9a69a20'

function fInt(n: number) {
  return new Intl.NumberFormat('pt-BR').format(Math.round(n))
}

function fPct(n: number) {
  return `${(n * 100).toFixed(1)}%`
}

type FunilRow = {
  date: string
  meetings_scheduled: number
  meetings_completed: number
  deals_won: number
}

export default async function FunilVendasPage() {
  const resolved = await resolveEffectiveClient(undefined)

  if (!resolved.ok) {
    return (
      <main className="app-shell">
        <div className="ds-nav reveal d1">
          <div className="ds-nav-logo">
            <span className="ds-nav-logo-dot" />
            <span>Funil de Vendas</span>
          </div>
        </div>
        <p style={{ padding: 24 }}>Não foi possível carregar seu perfil.</p>
      </main>
    )
  }

  if (resolved.effectiveClientId !== AGENCIA_CLIENT_ID) {
    return (
      <main className="app-shell">
        <div className="ds-nav reveal d1">
          <div className="ds-nav-logo">
            <span className="ds-nav-logo-dot" />
            <span>Funil de Vendas</span>
          </div>
        </div>
        <p style={{ padding: 24 }}>
          Essa página não está disponível para esse cliente. <a href="/dashboard">Voltar ao dashboard</a>
        </p>
      </main>
    )
  }

  const { data, error } = await getSupabaseAdminClient()
    .from('sales_funnel_daily')
    .select('date,meetings_scheduled,meetings_completed,deals_won')
    .eq('client_id', AGENCIA_CLIENT_ID)
    .order('date', { ascending: false })

  const rows = (data || []) as FunilRow[]
  const tableMissing = error?.code === '42P01'

  const totals = rows.reduce(
    (acc, r) => ({
      scheduled: acc.scheduled + (r.meetings_scheduled || 0),
      completed: acc.completed + (r.meetings_completed || 0),
      won: acc.won + (r.deals_won || 0),
    }),
    { scheduled: 0, completed: 0, won: 0 }
  )

  const funnel = [
    { stage: 'Reuniões Agendadas', value: totals.scheduled, widthPct: 90 },
    {
      stage: 'Reuniões Realizadas',
      value: totals.completed,
      widthPct: 66,
      rate: totals.scheduled > 0 ? totals.completed / totals.scheduled : 0,
    },
    {
      stage: 'Contratos Fechados',
      value: totals.won,
      widthPct: 40,
      rate: totals.completed > 0 ? totals.won / totals.completed : 0,
    },
  ]

  return (
    <main className="app-shell">
      <div className="ds-nav reveal d1">
        <div className="ds-nav-logo">
          <span className="ds-nav-logo-dot" />
          <span>Funil de Vendas</span>
        </div>
        <span className="ds-pill">Gold Media</span>
        <div className="ds-nav-logout" style={{ display: 'flex', gap: 8 }}>
          <a href="/dashboard" className="button-secondary" style={{ padding: '6px 14px', borderRadius: 8, fontSize: 12 }}>
            ← Dashboard
          </a>
        </div>
      </div>

      {tableMissing ? (
        <p style={{ padding: 24 }}>
          A tabela de funil ainda não foi criada no banco. Fale com quem configurou a integração.
        </p>
      ) : (
        <>
          <section className="reveal d2" style={{ padding: '24px 0' }}>
            <div className="funnel-shape">
              {funnel.map((step, index) => (
                <div className="funnel-row" key={step.stage}>
                  <div className="funnel-bar" style={{ width: `${step.widthPct}%` }}>
                    <span className="funnel-title">{step.stage}</span>
                    <span className="funnel-value">{fInt(step.value)}</span>
                    {index > 0 ? (
                      <span className="funnel-rate">Taxa: {fPct(step.rate || 0)}</span>
                    ) : (
                      <span />
                    )}
                  </div>
                </div>
              ))}
            </div>
            <p style={{ marginTop: 12, opacity: 0.7, fontSize: 13 }}>
              Últimos {rows.length} dias com dados · Reuniões via Calendly · Realizadas via Fathom · Fechamentos via ClickUp
            </p>
          </section>

          <section className="reveal d3">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Reuniões Agendadas</th>
                    <th>Reuniões Realizadas</th>
                    <th>Contratos Fechados</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.date}>
                      <td>{r.date}</td>
                      <td>{fInt(r.meetings_scheduled)}</td>
                      <td>{fInt(r.meetings_completed)}</td>
                      <td>{fInt(r.deals_won)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  )
}
