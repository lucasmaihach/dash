/**
 * Sincroniza dados da Meta Ads API para um cliente no Supabase.
 *
 * Uso:
 *   node scripts/sync-meta.mjs <client_id> [dias]
 *
 * Exemplo:
 *   node scripts/sync-meta.mjs 9df89270-16ef-476d-b758-dea690fe5d78 180
 */

import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// Carregar .env.local
// ---------------------------------------------------------------------------
function loadEnv() {
  try {
    const raw = readFileSync('.env.local', 'utf-8')
    return Object.fromEntries(
      raw.split('\n')
        .filter(l => l.includes('=') && !l.startsWith('#'))
        .map(l => {
          const idx = l.indexOf('=')
          const key = l.slice(0, idx).trim()
          const val = l.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '')
          return [key, val]
        })
    )
  } catch {
    return {}
  }
}

const env = loadEnv()
const SUPABASE_URL = env.SUPABASE_URL || process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
const META_API_VERSION = env.META_API_VERSION || 'v21.0'

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Faltam SUPABASE_URL e/ou SUPABASE_SERVICE_ROLE_KEY no .env.local')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

// ---------------------------------------------------------------------------
// Argumentos
// ---------------------------------------------------------------------------
const CLIENT_ID = process.argv[2]
const DAYS = parseInt(process.argv[3] || '180', 10)

if (!CLIENT_ID) {
  console.error('Uso: node scripts/sync-meta.mjs <client_id> [dias]')
  console.error('Exemplo: node scripts/sync-meta.mjs 9df89270-16ef-476d-b758-dea690fe5d78 180')
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Buscar credenciais no Supabase
// ---------------------------------------------------------------------------
async function getCredentials(clientId) {
  const [credRes, accountRes, clientRes] = await Promise.all([
    supabase.from('client_meta_credentials').select('access_token').eq('client_id', clientId).eq('is_active', true).single(),
    supabase.from('client_ad_accounts').select('ad_account_id, label').eq('client_id', clientId).eq('is_active', true).single(),
    supabase.from('clients').select('name').eq('id', clientId).single()
  ])

  if (credRes.error || !credRes.data?.access_token) {
    console.error('❌ Token não encontrado para o cliente', clientId)
    console.error(credRes.error?.message)
    process.exit(1)
  }

  if (accountRes.error || !accountRes.data?.ad_account_id) {
    console.error('❌ Conta de anúncios não encontrada para o cliente', clientId)
    console.error(accountRes.error?.message)
    process.exit(1)
  }

  return {
    clientName: clientRes.data?.name || clientId,
    accessToken: credRes.data.access_token,
    adAccountId: accountRes.data.ad_account_id,
    accountLabel: accountRes.data.label
  }
}

// ---------------------------------------------------------------------------
// Chamar Meta Insights API com paginação
// ---------------------------------------------------------------------------
async function fetchMetaInsights({ adAccountId, accessToken, level, since, until, fields }) {
  const results = []
  const params = new URLSearchParams({
    access_token: accessToken,
    level,
    time_increment: '1',
    time_range: JSON.stringify({ since, until }),
    fields,
    limit: '500'
  })

  let url = `https://graph.facebook.com/${META_API_VERSION}/act_${adAccountId}/insights?${params}`
  let page = 1

  while (url) {
    process.stdout.write(`  Página ${page}...`)
    const res = await fetch(url)
    const json = await res.json()

    if (json.error) {
      console.error('\n❌ Meta API erro:', json.error.message)
      break
    }

    const data = json.data || []
    process.stdout.write(` ${data.length} registros\n`)
    results.push(...data)

    url = json.paging?.next || null
    page++
  }

  return results
}

// ---------------------------------------------------------------------------
// Parsear row de campanha
// ---------------------------------------------------------------------------
function parseCampaignRow(row, clientId) {
  const actions = row.actions || []
  const getAction = (...types) => {
    for (const t of types) {
      const match = actions.find(a => a.action_type === t)
      if (match) return parseFloat(match.value) || 0
    }
    return 0
  }

  return {
    client_id: clientId,
    date: row.date_start,
    campaign_name: row.campaign_name || null,
    project_tag: '',
    reach: parseInt(row.reach || '0'),
    impressions: parseInt(row.impressions || '0'),
    amount_spent: parseFloat(row.spend || '0'),
    link_clicks: parseInt(row.inline_link_clicks || '0'),
    landing_page_views: Math.round(getAction('landing_page_view')),
    leads: Math.round(getAction('lead', 'onsite_conversion.lead_grouped', 'onsite_conversion.messaging_first_reply'))
  }
}

// ---------------------------------------------------------------------------
// Parsear row de anúncio
// ---------------------------------------------------------------------------
function parseAdRow(row, clientId) {
  const base = parseCampaignRow(row, clientId)
  return {
    ...base,
    adset_name: row.adset_name || null,
    ad_name: row.ad_name || null
  }
}

// ---------------------------------------------------------------------------
// Inserir em lotes no Supabase
// ---------------------------------------------------------------------------
async function upsertInBatches(table, rows, clientId, since, until) {
  if (rows.length === 0) {
    console.log(`  Nenhum dado para inserir em ${table}`)
    return
  }

  // Deletar dados antigos do período
  const { error: delError } = await supabase
    .from(table)
    .delete()
    .eq('client_id', clientId)
    .gte('date', since)
    .lte('date', until)

  if (delError) {
    console.error(`  ⚠️  Erro ao deletar dados antigos de ${table}:`, delError.message)
  }

  // Inserir em lotes de 500
  const BATCH = 500
  let inserted = 0
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH)
    const { error } = await supabase.from(table).insert(batch)
    if (error) {
      console.error(`  ❌ Erro ao inserir lote em ${table}:`, error.message)
      if (error.details) console.error('  Detalhes:', error.details)
    } else {
      inserted += batch.length
    }
  }
  console.log(`  ✅ ${inserted} registros inseridos em ${table}`)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`\n🚀 Sincronização Meta Ads`)
  console.log(`   Client ID : ${CLIENT_ID}`)
  console.log(`   Período   : últimos ${DAYS} dias`)

  const { clientName, accessToken, adAccountId, accountLabel } = await getCredentials(CLIENT_ID)
  console.log(`   Cliente   : ${clientName}`)
  console.log(`   Conta     : ${accountLabel || adAccountId} (act_${adAccountId})`)

  // Calcular datas
  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - DAYS)
  const since = start.toISOString().slice(0, 10)
  const until = end.toISOString().slice(0, 10)
  console.log(`   De ${since} até ${until}\n`)

  // --- Nível campanha ---
  console.log('📊 Buscando dados de campanha...')
  const rawCampaign = await fetchMetaInsights({
    adAccountId,
    accessToken,
    level: 'campaign',
    since,
    until,
    fields: 'campaign_name,reach,impressions,spend,inline_link_clicks,actions'
  })
  const campaignRows = rawCampaign.map(r => parseCampaignRow(r, CLIENT_ID))
  await upsertInBatches('meta_daily_campaign_metrics', campaignRows, CLIENT_ID, since, until)

  // --- Nível anúncio ---
  console.log('\n📊 Buscando dados de anúncios...')
  const rawAds = await fetchMetaInsights({
    adAccountId,
    accessToken,
    level: 'ad',
    since,
    until,
    fields: 'campaign_name,adset_name,ad_name,reach,impressions,spend,inline_link_clicks,actions'
  })
  const adRows = rawAds.map(r => parseAdRow(r, CLIENT_ID))
  await upsertInBatches('meta_daily_ad_metrics', adRows, CLIENT_ID, since, until)

  console.log('\n✅ Sincronização concluída!')
}

main().catch(err => {
  console.error('❌ Erro fatal:', err.message)
  process.exit(1)
})
