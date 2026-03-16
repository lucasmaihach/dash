import Link from 'next/link'
import { unstable_cache } from 'next/cache'
import { byCampaign, byDay, consolidate, fFloat, fInt, fMoney, fPct, type MetricRow } from '@/lib/dashboard'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { getSupabaseAdminClient } from '@/lib/supabase/admin'
import { resolveEffectiveClient } from '@/lib/auth'
import { createProductReportAction, deleteProductReportAction, refreshClientDataAction } from './actions'
import { DailySection, type DayRow } from './DailySection'
import { SortableTable } from './SortableTable'
import { AdCreativesGrid, type CreativeCard } from './AdCreativesGrid'

// Cache da query principal por 2 minutos — isolado por cliente.
// A key inclui o clientId explicitamente para garantir entradas separadas no cache.
// A tag `metrics:<clientId>` permite invalidação granular via /api/revalidate após ingestão.
function getCachedMetrics(clientId: string) {
  return unstable_cache(
    async () => {
      const { data, error } = await getSupabaseAdminClient()
        .from('meta_daily_campaign_metrics')
        .select('date,campaign_name,project_tag,reach,impressions,amount_spent,link_clicks,landing_page_views,leads')
        .eq('client_id', clientId)
        .order('date', { ascending: false })
      return { data: (data || []) as MetricRow[], error }
    },
    [`campaign-metrics:${clientId}`],
    { revalidate: 120, tags: [`metrics:${clientId}`] }
  )()
}

type DashboardView = 'executivo' | 'daily' | 'ads' | 'adsets' | 'creatives'

type Search = {
  report?: string
  view?: DashboardView
  tag?: string
  campaign?: string
  start?: string
  end?: string
  error?: string
  as?: string
  sync?: 'done' | 'failed'
}

type DashboardPageProps = {
  searchParams: Promise<Search>
}

type ProductReport = {
  id: string
  name: string
  tag_filter: string
  campaign_filter: string | null
}

type AdMetricRow = MetricRow & {
  ad_name: string | null
  adset_name: string | null
}

type AdCreativeLinkRow = {
  ad_name: string | null
  ad_snapshot_url: string | null
  link_url: string | null
}

function makeDateValue(value: string | undefined, fallback: string): string {
  if (!value) return fallback
  return value
}

function buildDashboardHref(base: Search, patch: Partial<Search>) {
  const qp = new URLSearchParams()
  const merged: Search = { ...base, ...patch }

  if (merged.report) qp.set('report', merged.report)
  if (merged.view) qp.set('view', merged.view)
  if (merged.tag) qp.set('tag', merged.tag)
  if (merged.campaign) qp.set('campaign', merged.campaign)
  if (merged.start) qp.set('start', merged.start)
  if (merged.end) qp.set('end', merged.end)
  if (merged.as) qp.set('as', merged.as)

  const suffix = qp.toString()
  return suffix ? `/dashboard?${suffix}` : '/dashboard'
}

function normalizeEntityKey(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function rankByEntity(rows: AdMetricRow[], key: 'ad_name' | 'adset_name') {
  const grouped = new Map<string, MetricRow[]>()

  for (const row of rows) {
    const rawName = row[key]
    const name = rawName && rawName.trim() ? rawName : '(sem nome)'
    const list = grouped.get(name) || []
    list.push(row)
    grouped.set(name, list)
  }

  return Array.from(grouped.entries())
    .map(([name, items]) => ({ name, totals: consolidate(items) }))
    .sort((a, b) => {
      if (b.totals.leads !== a.totals.leads) return b.totals.leads - a.totals.leads
      if (b.totals.link_clicks !== a.totals.link_clicks) return b.totals.link_clicks - a.totals.link_clicks
      return b.totals.amount_spent - a.totals.amount_spent
    })
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const params = await searchParams
  const syncMsg = params.sync === 'done'
    ? 'Dados atualizados com sucesso.'
    : params.sync === 'failed'
      ? 'Falha ao atualizar os dados. Verifique logs e tente novamente.'
      : null

  // Resolve o clientId efetivo com todas as validações de segurança:
  // - autentica o usuário
  // - valida UUID e existência do cliente quando admin usa ?as=
  // - garante que não-admins nunca acessam dados de outros clientes
  const resolved = await resolveEffectiveClient(params.as)

  if (!resolved.ok) {
    return (
      <main className="app-shell page-wrap">
        <section className="panel reveal d2">
          <h2>Configuração de acesso</h2>
          <p>Seu usuário não possui client_id vinculado em <code>profiles</code>.</p>
        </section>
      </main>
    )
  }

  const { effectiveClientId, isAdminView, profile } = resolved
  const supabase = await getSupabaseServerClient()
  const dataClient = isAdminView ? getSupabaseAdminClient() : supabase

  // Busca nome da empresa do cliente (sempre via admin — já validado acima)
  const { data: clientData } = await getSupabaseAdminClient()
    .from('clients')
    .select('name')
    .eq('id', effectiveClientId)
    .single()
  const viewingClientName = clientData?.name || null

  const { data: baseRows, error: baseError } = await getCachedMetrics(effectiveClientId)

  if (baseError) {
    return (
      <main className="app-shell page-wrap">
        <section className="panel reveal d2">
          <h2>Erro de dados</h2>
          <p>Falha ao carregar métricas da tabela <code>meta_daily_campaign_metrics</code>.</p>
        </section>
      </main>
    )
  }

  const rows = (baseRows || []) as MetricRow[]

  if (rows.length === 0) {
    return (
      <main className="app-shell page-wrap">
        <section className="panel reveal d2">
          <h2>Sem dados</h2>
          <p>Nenhum registro encontrado para este client_id.</p>
          {profile.role === 'admin' && !params.as ? (
            <p style={{ marginTop: 8 }}>
              <a href="/admin" className="button-secondary" style={{ fontSize: 13 }}>
                ← Selecionar cliente no Admin
              </a>
            </p>
          ) : null}
        </section>
      </main>
    )
  }

  const reportRes = await dataClient
    .from('product_reports')
    .select('id,name,tag_filter,campaign_filter')
    .eq('client_id', effectiveClientId)
    .order('created_at', { ascending: true })

  const reportTableMissing = reportRes.error?.code === '42P01'
  const reports = (reportRes.data || []) as ProductReport[]
  const selectedReport = reports.find((r) => r.id === params.report) || reports[0] || null

  const allDates = rows.map((r) => r.date).sort()
  const minDate = allDates[0]
  const maxDate = allDates[allDates.length - 1]

  const selectedView: DashboardView = params.view || 'executivo'
  const selectedTag = params.tag ?? selectedReport?.tag_filter ?? ''
  const selectedCampaignQuery = params.campaign ?? selectedReport?.campaign_filter ?? ''
  const start = makeDateValue(params.start, minDate)
  const end = makeDateValue(params.end, maxDate)

  const filtered = rows.filter((r) => {
    const byTag = selectedTag
      ? (r.project_tag || '').toLowerCase().includes(selectedTag.toLowerCase()) ||
        (r.campaign_name || '').toLowerCase().includes(selectedTag.toLowerCase())
      : true
    const byCampaign = selectedCampaignQuery
      ? (r.campaign_name || '').toLowerCase().includes(selectedCampaignQuery.toLowerCase())
      : true
    const byStart = start ? r.date >= start : true
    const byEnd = end ? r.date <= end : true
    return byTag && byCampaign && byStart && byEnd
  })

  const totals = consolidate(filtered)
  const byDayRows = byDay(filtered)
  const campaignRows = byCampaign(filtered)

  const funnel = [
    { stage: 'Impressions', value: totals.impressions },
    { stage: 'Reach', value: totals.reach, rate: totals.impressions > 0 ? totals.reach / totals.impressions : 0 },
    { stage: 'Link Clicks', value: totals.link_clicks, rate: totals.reach > 0 ? totals.link_clicks / totals.reach : 0 },
    {
      stage: 'Landing Page Views',
      value: totals.landing_page_views,
      rate: totals.link_clicks > 0 ? totals.landing_page_views / totals.link_clicks : 0
    },
    { stage: 'Leads', value: totals.leads, rate: totals.landing_page_views > 0 ? totals.leads / totals.landing_page_views : 0 }
  ]

  const totalFunnelRate = totals.impressions > 0 ? totals.leads / totals.impressions : 0
  const funnelVisualWidths = [88, 76, 64, 52, 40]
  const funnelWithWidth = funnel.map((step, index) => ({
    ...step,
    widthPct: funnelVisualWidths[index] ?? 40,
    transitionRate: index === 0 ? null : step.rate || 0
  }))

  const needsAdLevelData = selectedView === 'ads' || selectedView === 'adsets' || selectedView === 'creatives'
  let adTableMissing = false
  let bestAds: Array<{ name: string; totals: ReturnType<typeof consolidate> }> = []
  let bestAdsets: Array<{ name: string; totals: ReturnType<typeof consolidate> }> = []
  let creativeCards: CreativeCard[] = []
  let creativesTableMissing = false
  const adPublicLinkByName = new Map<string, string>()

  if (needsAdLevelData) {
    const adRes = await dataClient
      .from('meta_daily_ad_metrics')
      .select('date,campaign_name,project_tag,adset_name,ad_name,reach,impressions,amount_spent,link_clicks,landing_page_views,leads')
      .eq('client_id', effectiveClientId)
      .gte('date', start)
      .lte('date', end)

    adTableMissing = adRes.error?.code === '42P01'
    const adRows = ((adRes.data || []) as AdMetricRow[]).filter((r) => {
      const byTag = selectedTag
        ? (r.project_tag || '').toLowerCase().includes(selectedTag.toLowerCase()) ||
          (r.campaign_name || '').toLowerCase().includes(selectedTag.toLowerCase())
        : true
      const byCampaign = selectedCampaignQuery
        ? (r.campaign_name || '').toLowerCase().includes(selectedCampaignQuery.toLowerCase())
        : true
      return byTag && byCampaign
    })

    bestAds = rankByEntity(adRows, 'ad_name').slice(0, 20)
    bestAdsets = rankByEntity(adRows, 'adset_name').slice(0, 20)

    if (selectedView === 'ads') {
      // Link público do anúncio (prioriza ad_snapshot_url; fallback para link_url)
      const adLinksRes = await dataClient
        .from('meta_ad_creatives')
        .select('ad_name,ad_snapshot_url,link_url')
        .eq('client_id', effectiveClientId)

      let adLinkRows: AdCreativeLinkRow[] = []

      if (adLinksRes.error?.code === '42703') {
        const fallbackRes = await dataClient
          .from('meta_ad_creatives')
          .select('ad_name,link_url')
          .eq('client_id', effectiveClientId)

        adLinkRows = ((fallbackRes.data || []) as Array<{ ad_name: string | null; link_url: string | null }>).map((r) => ({
          ad_name: r.ad_name,
          ad_snapshot_url: null,
          link_url: r.link_url,
        }))
      } else {
        adLinkRows = (adLinksRes.data || []) as AdCreativeLinkRow[]
      }

      for (const row of adLinkRows) {
        const adNameKey = normalizeEntityKey(row.ad_name)
        if (!adNameKey || adPublicLinkByName.has(adNameKey)) continue
        const publicUrl = row.ad_snapshot_url || row.link_url
        if (publicUrl) adPublicLinkByName.set(adNameKey, publicUrl)
      }
    }

    // Criativos: busca thumbnails + métricas agregadas por ad_id
    if (selectedView === 'creatives') {
      const creativesRes = await dataClient
        .from('meta_ad_creatives')
        .select('ad_id,ad_name,creative_type,thumbnail_url,video_id,link_url,ad_snapshot_url,call_to_action_type')
        .eq('client_id', effectiveClientId)

      // 42P01 = tabela não existe | 42703 = coluna não existe (creative_type ausente)
      creativesTableMissing = ['42P01', '42703'].includes(creativesRes.error?.code ?? '')

      if (!creativesTableMissing && creativesRes.data) {
        // Monta mapa de métricas por ad_name (join via nome pois ad_id não está em ad_metrics)
        const metricsByAdName = new Map<string, ReturnType<typeof consolidate>>()
        for (const entry of bestAds) {
          metricsByAdName.set(entry.name, entry.totals)
        }

        creativeCards = creativesRes.data
          .map((c) => {
            const adName = c.ad_name ?? ''
            const m = metricsByAdName.get(adName)
            return {
              ad_id: c.ad_id,
              ad_name: c.ad_name,
              creative_type: (c.creative_type ?? 'unknown') as CreativeCard['creative_type'],
              thumbnail_url: c.thumbnail_url,
              video_id: c.video_id,
              link_url: c.link_url,
              ad_snapshot_url: c.ad_snapshot_url ?? null,
              call_to_action_type: c.call_to_action_type,
              amount_spent: m ? fMoney(m.amount_spent) : '—',
              leads: m ? fInt(m.leads) : '—',
              cpl: m ? fMoney(m.cpl) : '—',
              impressions: m ? fInt(m.impressions) : '—',
              ctr: m ? fPct(m.ctr) : '—',
              cpc: m ? fMoney(m.cpc) : '—',
            } satisfies CreativeCard
          })
          // Ordena: ads com métricas primeiro, depois por leads desc
          .sort((a, b) => {
            const aLeads = a.leads === '—' ? -1 : parseInt(a.leads.replace(/\D/g, '')) || 0
            const bLeads = b.leads === '—' ? -1 : parseInt(b.leads.replace(/\D/g, '')) || 0
            return bLeads - aLeads
          })
          .slice(0, 30)
      }
    }
  }

  const baseHref: Search = {
    report: selectedReport?.id,
    view: selectedView,
    tag: selectedTag || undefined,
    campaign: selectedCampaignQuery || undefined,
    start,
    end,
    as: isAdminView ? params.as : undefined,
  }

  const currentDashboardHref = buildDashboardHref(baseHref, {})

  const viewTabs: Array<{ id: DashboardView; label: string }> = [
    { id: 'executivo', label: 'Executivo' },
    { id: 'daily', label: 'Desempenho Diário' },
    { id: 'ads', label: 'Melhores Anúncios' },
    { id: 'adsets', label: 'Melhores Conjuntos' },
    { id: 'creatives', label: 'Criativos' },
  ]

  // Dados leves para a tabela diária — campanhas carregadas on-demand via /api/day-detail
  const allDaysData: DayRow[] = selectedView === 'daily'
    ? byDayRows.map((day) => ({
        date: day.date,
        totals: {
          amount_spent: fMoney(day.totals.amount_spent),
          leads: fInt(day.totals.leads),
          cpl: fMoney(day.totals.cpl),
          impressions: fInt(day.totals.impressions),
          reach: fInt(day.totals.reach),
          link_clicks: fInt(day.totals.link_clicks),
          cpc: fMoney(day.totals.cpc),
          ctr: fPct(day.totals.ctr),
        },
        amount_spent: fMoney(day.totals.amount_spent),
        reach: fInt(day.totals.reach),
        impressions: fInt(day.totals.impressions),
        link_clicks: fInt(day.totals.link_clicks),
        landing_page_views: fInt(day.totals.landing_page_views),
        leads: fInt(day.totals.leads),
        cpc: fMoney(day.totals.cpc),
        cpl: fMoney(day.totals.cpl),
        ctr: fPct(day.totals.ctr),
        cpm: fMoney(day.totals.cpm),
        connect_rate: fPct(day.totals.connect_rate),
      }))
    : []

  return (
    <main className="app-shell">
      <div className="ds-nav reveal d1">
        <div className="ds-nav-logo">
          <span className="ds-nav-logo-dot" />
          <span>Dashboard de Anúncios</span>
        </div>
        <span className="ds-pill">Dashboard</span>
        {isAdminView ? (
          <span className="ds-pill mono" style={{ color: '#fbbf24' }}>
            👁 {viewingClientName || effectiveClientId.slice(0, 8)}
          </span>
        ) : (
          <span className="ds-pill mono">{viewingClientName || effectiveClientId.slice(0, 8)}</span>
        )}
        <div className="ds-nav-logout" style={{ display: 'flex', gap: 8 }}>
          {isAdminView ? (
            <a href="/admin" className="button-secondary" style={{ padding: '6px 14px', borderRadius: 8, fontSize: 12 }}>
              ← Admin
            </a>
          ) : null}
          <form action={refreshClientDataAction}>
            {isAdminView ? <input type="hidden" name="as" value={params.as} /> : null}
            <input type="hidden" name="return_to" value={currentDashboardHref} />
            <button className="button-secondary" type="submit">Atualizar dados</button>
          </form>
          <form action="/api/logout" method="post">
            <button className="button-secondary" type="submit">Sair</button>
          </form>
        </div>
      </div>

      <div className="page-wrap">
        <section className="hero reveal d2">
          <h1>{viewingClientName || profile.full_name?.split(' ')[0] || 'Dashboard'}.</h1>
          <p>Seja bem-vindo de volta{profile.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}.</p>
        </section>

        {syncMsg ? (
          <section className="panel reveal d3">
            <p style={{ color: params.sync === 'done' ? '#4ade80' : '#f87171', fontWeight: 600 }}>{syncMsg}</p>
          </section>
        ) : null}

        <section className="panel reveal d3">
          <h2>Relatórios de Produto</h2>
          {reportTableMissing ? (
            <p className="error">Tabela <code>product_reports</code> não encontrada. Execute o SQL atualizado.</p>
          ) : null}
          {params.error === 'missing_report_fields' ? <p className="error">Preencha nome do relatório e TAG.</p> : null}
          {params.error === 'create_report_failed' ? <p className="error">Falha ao criar relatório.</p> : null}

          <div className="report-tabs">
            {reports.map((report) => (
              <div key={report.id} className="report-tab-wrapper">
                <Link
                  href={buildDashboardHref(
                    // Ao trocar de relatório, limpa filtros manuais para carregar
                    // os defaults do novo relatório (tag_filter e campaign_filter)
                    { ...baseHref, tag: undefined, campaign: undefined, start: undefined, end: undefined },
                    { report: report.id }
                  )}
                  className={`report-tab ${selectedReport?.id === report.id ? 'active' : ''}`}
                >
                  {report.name}
                </Link>
                <form action={deleteProductReportAction} className="report-tab-delete-form">
                  <input type="hidden" name="report_id" value={report.id} />
                  {isAdminView ? <input type="hidden" name="as" value={params.as} /> : null}
                  <button
                    type="submit"
                    className="report-tab-delete"
                    title={`Excluir relatório "${report.name}"`}
                    aria-label={`Excluir relatório "${report.name}"`}
                  >
                    ✕
                  </button>
                </form>
              </div>
            ))}
          </div>

          <form action={createProductReportAction} className="filters report-create-form">
            {isAdminView ? <input type="hidden" name="as" value={params.as} /> : null}
            <div className="field">
              <label htmlFor="report_name">Nome do painel</label>
              <input id="report_name" name="report_name" placeholder="Ex: Captação de Leads" required />
            </div>
            <div className="field">
              <label htmlFor="report_tag">TAG base</label>
              <input id="report_tag" name="report_tag" placeholder="Ex: [LEADS]" required />
            </div>
            <div className="field">
              <label htmlFor="report_campaign">Filtro inicial de campanha (opcional)</label>
              <input id="report_campaign" name="report_campaign" placeholder="Ex: remarketing" />
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
                <span className="inner">Criar Relatório</span>
              </button>
            </div>
          </form>
        </section>

        <section className="panel reveal d3">
          <h2>Visualizações</h2>
          <div className="report-tabs">
            {viewTabs.map((tab) => (
              <Link
                key={tab.id}
                href={buildDashboardHref(baseHref, { view: tab.id })}
                className={`report-tab ${selectedView === tab.id ? 'active' : ''}`}
              >
                {tab.label}
              </Link>
            ))}
          </div>
        </section>

        <section className="panel reveal d3">
          <h2>Filtros</h2>
          <form className="filters" method="get">
            <input type="hidden" name="view" value={selectedView} />
            <input type="hidden" name="report" value={selectedReport?.id || ''} />
            {isAdminView ? <input type="hidden" name="as" value={params.as} /> : null}

            <div className="field">
              <label htmlFor="tag">TAG (contém)</label>
              <input id="tag" name="tag" defaultValue={selectedTag} placeholder="Digite a TAG" />
            </div>
            <div className="field">
              <label htmlFor="campaign">Nome da campanha (contém)</label>
              <input id="campaign" name="campaign" defaultValue={selectedCampaignQuery} placeholder="Digite parte do nome" />
            </div>
            <div className="field">
              <label htmlFor="start">Data inicial</label>
              <input id="start" name="start" type="date" defaultValue={start} />
            </div>
            <div className="field">
              <label htmlFor="end">Data final</label>
              <input id="end" name="end" type="date" defaultValue={end} />
            </div>
            <div className="field filter-actions">
              <label>&nbsp;</label>
              <div className="filter-actions-row">
                <button className="button-custom" type="submit">
                  <div className="points_wrapper" aria-hidden="true">
                    <i className="point" />
                    <i className="point" />
                    <i className="point" />
                    <i className="point" />
                  </div>
                  <span className="inner">Aplicar</span>
                </button>
                <Link href={buildDashboardHref(baseHref, { tag: undefined, campaign: undefined })} className="filter-clear-link">
                  <button className="button-secondary" type="button">Limpar</button>
                </Link>
              </div>
            </div>
          </form>
        </section>

        {selectedView === 'executivo' ? (
          <>
            <section className="panel reveal d4">
              <h2>A) Painel Executivo</h2>
              <div className="metrics-grid">
                <div className="metric"><div className="label">Investimento Total</div><div className="value">{fMoney(totals.amount_spent)}</div></div>
                <div className="metric"><div className="label">Reach</div><div className="value">{fInt(totals.reach)}</div></div>
                <div className="metric"><div className="label">Impressões</div><div className="value">{fInt(totals.impressions)}</div></div>
                <div className="metric"><div className="label">Frequência</div><div className="value">{fFloat(totals.frequency)}</div></div>
                <div className="metric"><div className="label">Link Clicks</div><div className="value">{fInt(totals.link_clicks)}</div></div>
                <div className="metric"><div className="label">Landing Page Views</div><div className="value">{fInt(totals.landing_page_views)}</div></div>
                <div className="metric"><div className="label">Leads</div><div className="value">{fInt(totals.leads)}</div></div>
                <div className="metric"><div className="label">CPC</div><div className="value">{fMoney(totals.cpc)}</div></div>
                <div className="metric"><div className="label">CPL</div><div className="value">{fMoney(totals.cpl)}</div></div>
                <div className="metric"><div className="label">CPM</div><div className="value">{fMoney(totals.cpm)}</div></div>
                <div className="metric"><div className="label">CTR</div><div className="value">{fPct(totals.ctr)}</div></div>
                <div className="metric"><div className="label">Connect Rate</div><div className="value">{fPct(totals.connect_rate)}</div></div>
              </div>
            </section>

            <section className="panel reveal d5">
              <h2>B) Funil Visual</h2>
              <div className="funnel-shape">
                {funnelWithWidth.map((step, index) => (
                  <div className="funnel-row" key={step.stage}>
                    <div className="funnel-bar" style={{ width: `${step.widthPct}%` }}>
                      <span className="funnel-title">{step.stage}</span>
                      <span className="funnel-value">{fInt(step.value)}</span>
                      {index > 0 ? <span className="funnel-rate">Taxa: {fPct(step.transitionRate || 0)}</span> : <span />}
                    </div>
                  </div>
                ))}
              </div>
              <p style={{ marginTop: 8, color: 'var(--text-muted)' }}>Conversão total do funil: {fPct(totalFunnelRate)}</p>
            </section>

            <section className="panel reveal d6">
              <h2>C) Visão por Campanha</h2>
              <div className="table-wrap">
                <SortableTable
                  columns={[
                    { key: 'name', label: 'Campaign Name' },
                    { key: 'amount_spent', label: 'Amount Spent' },
                    { key: 'reach', label: 'Reach' },
                    { key: 'impressions', label: 'Impressions' },
                    { key: 'link_clicks', label: 'Link Clicks' },
                    { key: 'landing_page_views', label: 'Landing Page Views' },
                    { key: 'leads', label: 'Leads' },
                    { key: 'cpc', label: 'CPC' },
                    { key: 'cpl', label: 'CPL' },
                    { key: 'ctr', label: 'CTR' },
                    { key: 'cpm', label: 'CPM' },
                    { key: 'connect_rate', label: 'Connect Rate' },
                  ]}
                  rows={campaignRows.map((row) => ({
                    name: row.campaign_name,
                    amount_spent: fMoney(row.totals.amount_spent),
                    reach: fInt(row.totals.reach),
                    impressions: fInt(row.totals.impressions),
                    link_clicks: fInt(row.totals.link_clicks),
                    landing_page_views: fInt(row.totals.landing_page_views),
                    leads: fInt(row.totals.leads),
                    cpc: fMoney(row.totals.cpc),
                    cpl: fMoney(row.totals.cpl),
                    ctr: fPct(row.totals.ctr),
                    cpm: fMoney(row.totals.cpm),
                    connect_rate: fPct(row.totals.connect_rate),
                  }))}
                  firstColStyle={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                />
              </div>
            </section>
          </>
        ) : null}

        {selectedView === 'daily' ? (
          <section className="panel reveal d4">
            <h2>Desempenho Diário</h2>
            <DailySection
              days={allDaysData}
              clientId={effectiveClientId}
              tag={selectedTag}
              campaignFilter={selectedCampaignQuery}
            />
          </section>
        ) : null}

        {selectedView === 'ads' ? (
          <section className="panel reveal d4">
            <h2>Melhores Anúncios</h2>
            {adTableMissing ? <p className="error">Tabela <code>meta_daily_ad_metrics</code> não encontrada.</p> : null}
            <div className="table-wrap">
              <SortableTable
                columns={[
                  { key: 'name', label: 'Ad Name' },
                  { key: 'public_link', label: 'Link Público', type: 'link' },
                  { key: 'amount_spent', label: 'Amount Spent' },
                  { key: 'reach', label: 'Reach' },
                  { key: 'impressions', label: 'Impressions' },
                  { key: 'link_clicks', label: 'Link Clicks' },
                  { key: 'landing_page_views', label: 'Landing Page Views' },
                  { key: 'leads', label: 'Leads' },
                  { key: 'cpc', label: 'CPC' },
                  { key: 'cpl', label: 'CPL' },
                  { key: 'ctr', label: 'CTR' },
                  { key: 'cpm', label: 'CPM' },
                  { key: 'connect_rate', label: 'Connect Rate' },
                ]}
                rows={bestAds.map((row) => ({
                  name: row.name,
                  public_link: adPublicLinkByName.get(normalizeEntityKey(row.name)) || '—',
                  amount_spent: fMoney(row.totals.amount_spent),
                  reach: fInt(row.totals.reach),
                  impressions: fInt(row.totals.impressions),
                  link_clicks: fInt(row.totals.link_clicks),
                  landing_page_views: fInt(row.totals.landing_page_views),
                  leads: fInt(row.totals.leads),
                  cpc: fMoney(row.totals.cpc),
                  cpl: fMoney(row.totals.cpl),
                  ctr: fPct(row.totals.ctr),
                  cpm: fMoney(row.totals.cpm),
                  connect_rate: fPct(row.totals.connect_rate),
                }))}
                firstColStyle={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              />
            </div>
          </section>
        ) : null}

        {selectedView === 'adsets' ? (
          <section className="panel reveal d4">
            <h2>Melhores Conjuntos de Anúncios</h2>
            {adTableMissing ? <p className="error">Tabela <code>meta_daily_ad_metrics</code> não encontrada.</p> : null}
            <div className="table-wrap">
              <SortableTable
                columns={[
                  { key: 'name', label: 'Ad Set Name' },
                  { key: 'amount_spent', label: 'Amount Spent' },
                  { key: 'reach', label: 'Reach' },
                  { key: 'impressions', label: 'Impressions' },
                  { key: 'link_clicks', label: 'Link Clicks' },
                  { key: 'landing_page_views', label: 'Landing Page Views' },
                  { key: 'leads', label: 'Leads' },
                  { key: 'cpc', label: 'CPC' },
                  { key: 'cpl', label: 'CPL' },
                  { key: 'ctr', label: 'CTR' },
                  { key: 'cpm', label: 'CPM' },
                  { key: 'connect_rate', label: 'Connect Rate' },
                ]}
                rows={bestAdsets.map((row) => ({
                  name: row.name,
                  amount_spent: fMoney(row.totals.amount_spent),
                  reach: fInt(row.totals.reach),
                  impressions: fInt(row.totals.impressions),
                  link_clicks: fInt(row.totals.link_clicks),
                  landing_page_views: fInt(row.totals.landing_page_views),
                  leads: fInt(row.totals.leads),
                  cpc: fMoney(row.totals.cpc),
                  cpl: fMoney(row.totals.cpl),
                  ctr: fPct(row.totals.ctr),
                  cpm: fMoney(row.totals.cpm),
                  connect_rate: fPct(row.totals.connect_rate),
                }))}
                firstColStyle={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              />
            </div>
          </section>
        ) : null}

        {selectedView === 'creatives' ? (
          <section className="panel reveal d4">
            <h2>Criativos</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 16 }}>
              Thumbnails e métricas dos anúncios com imagem ou vídeo. Ordenado por Leads.
            </p>
            {creativesTableMissing ? (
              <p className="error">
                Tabela <code>meta_ad_creatives</code> não encontrada ou desatualizada.{' '}
                Execute o SQL em <code>docs/add_ad_creatives.sql</code> no Supabase.
              </p>
            ) : (
              <AdCreativesGrid cards={creativeCards} />
            )}
          </section>
        ) : null}
      </div>
    </main>
  )
}
