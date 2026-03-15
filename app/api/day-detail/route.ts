import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { getSupabaseAdminClient } from '@/lib/supabase/admin'
import { consolidate, fMoney, fInt, fPct, type MetricRow } from '@/lib/dashboard'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const clientId = searchParams.get('clientId') || ''
  const date = searchParams.get('date') || ''
  const tag = searchParams.get('tag') || ''
  const campaign = searchParams.get('campaign') || ''

  if (!clientId || !date) {
    return NextResponse.json({ error: 'missing_params', campaigns: [] }, { status: 400 })
  }

  // Auth: verificar que o usuário tem acesso ao clientId solicitado
  const supabase = await getSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated', campaigns: [] }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('client_id, role')
    .eq('id', user.id)
    .single()

  if (!profile) return NextResponse.json({ error: 'no_profile', campaigns: [] }, { status: 403 })
  if (profile.role !== 'admin' && profile.client_id !== clientId) {
    return NextResponse.json({ error: 'forbidden', campaigns: [] }, { status: 403 })
  }

  const { data, error: dbError } = await getSupabaseAdminClient()
    .from('meta_daily_campaign_metrics')
    .select('date,campaign_name,project_tag,reach,impressions,amount_spent,link_clicks,landing_page_views,leads')
    .eq('client_id', clientId)
    .eq('date', date)

  if (dbError) {
    console.error('[day-detail] db error:', dbError.message)
    return NextResponse.json({ error: 'db_error', campaigns: [] }, { status: 500 })
  }

  const rows = (data || []) as MetricRow[]

  const filtered = rows.filter((r) => {
    const byTag = tag
      ? (r.project_tag || '').toLowerCase().includes(tag.toLowerCase()) ||
        (r.campaign_name || '').toLowerCase().includes(tag.toLowerCase())
      : true
    const byCampaign = campaign
      ? (r.campaign_name || '').toLowerCase().includes(campaign.toLowerCase())
      : true
    return byTag && byCampaign
  })

  const grouped = new Map<string, MetricRow[]>()
  for (const row of filtered) {
    const name = row.campaign_name || '(sem nome)'
    const list = grouped.get(name) || []
    list.push(row)
    grouped.set(name, list)
  }

  const campaigns = Array.from(grouped.entries())
    .map(([name, items]) => ({ name, totals: consolidate(items) }))
    .sort((a, b) => b.totals.leads - a.totals.leads || b.totals.amount_spent - a.totals.amount_spent)
    .map((c) => ({
      name: c.name,
      amount_spent: fMoney(c.totals.amount_spent),
      leads: fInt(c.totals.leads),
      cpl: fMoney(c.totals.cpl),
      impressions: fInt(c.totals.impressions),
      reach: fInt(c.totals.reach),
      link_clicks: fInt(c.totals.link_clicks),
      cpc: fMoney(c.totals.cpc),
      ctr: fPct(c.totals.ctr),
      landing_page_views: fInt(c.totals.landing_page_views),
      connect_rate: fPct(c.totals.connect_rate),
    }))

  return NextResponse.json({ campaigns })
}
