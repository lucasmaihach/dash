export type MetricRow = {
  date: string
  campaign_name: string
  project_tag: string
  reach: number
  impressions: number
  amount_spent: number
  link_clicks: number
  landing_page_views: number
  leads: number
}

export type Totals = {
  amount_spent: number
  reach: number
  impressions: number
  frequency: number
  link_clicks: number
  landing_page_views: number
  leads: number
  cpc: number
  cpl: number
  cpm: number
  ctr: number
  connect_rate: number
  cost_per_lpv: number
}

function safeDiv(num: number, den: number): number {
  return den > 0 ? num / den : 0
}

export function consolidate(rows: MetricRow[]): Totals {
  const amount_spent = rows.reduce((acc, r) => acc + (r.amount_spent || 0), 0)
  const reach = rows.reduce((acc, r) => acc + (r.reach || 0), 0)
  const impressions = rows.reduce((acc, r) => acc + (r.impressions || 0), 0)
  const link_clicks = rows.reduce((acc, r) => acc + (r.link_clicks || 0), 0)
  const landing_page_views = rows.reduce((acc, r) => acc + (r.landing_page_views || 0), 0)
  const leads = rows.reduce((acc, r) => acc + (r.leads || 0), 0)

  return {
    amount_spent,
    reach,
    impressions,
    frequency: safeDiv(impressions, reach),
    link_clicks,
    landing_page_views,
    leads,
    cpc: safeDiv(amount_spent, link_clicks),
    cpl: safeDiv(amount_spent, leads),
    cpm: safeDiv(amount_spent, impressions) * 1000,
    ctr: safeDiv(link_clicks, impressions),
    connect_rate: safeDiv(landing_page_views, link_clicks),
    cost_per_lpv: safeDiv(amount_spent, landing_page_views)
  }
}

export function byCampaign(rows: MetricRow[]) {
  const grouped = new Map<string, MetricRow[]>()

  for (const row of rows) {
    const key = row.campaign_name
    const list = grouped.get(key) || []
    list.push(row)
    grouped.set(key, list)
  }

  return Array.from(grouped.entries())
    .map(([campaign_name, items]) => ({
      campaign_name,
      totals: consolidate(items)
    }))
    .sort((a, b) => b.totals.amount_spent - a.totals.amount_spent)
}

export function byDay(rows: MetricRow[]) {
  const grouped = new Map<string, MetricRow[]>()

  for (const row of rows) {
    const key = row.date
    const list = grouped.get(key) || []
    list.push(row)
    grouped.set(key, list)
  }

  return Array.from(grouped.entries())
    .map(([date, items]) => ({
      date,
      totals: consolidate(items)
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

export function fMoney(v: number): string {
  return `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function fInt(v: number): string {
  return v.toLocaleString('pt-BR', { maximumFractionDigits: 0 })
}

export function fPct(v: number): string {
  return `${(v * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
}

export function fFloat(v: number): string {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })
}
