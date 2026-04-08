import { createDecipheriv, scryptSync } from 'crypto'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ENCRYPT_KEY = process.env.ENCRYPT_KEY
const REVALIDATE_SECRET = process.env.REVALIDATE_SECRET
const APP_BASE_URL =
  (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || '').trim().replace(/\/$/, '')
const META_API_VERSION = process.env.META_API_VERSION || 'v21.0'
const META_DATE_PRESET = process.env.META_DATE_PRESET || 'last_30d'
const META_DAYS_BACK = Number(process.env.META_DAYS_BACK || '0')
const META_LEVEL = process.env.META_LEVEL || 'campaign'
const META_AD_LEVEL = process.env.META_AD_LEVEL || 'ad'
const META_TIME_INCREMENT = process.env.META_TIME_INCREMENT || '1'
const META_LIMIT = Number(process.env.META_LIMIT || '500')
const INGEST_ONLY_CLIENT_ID = (process.env.INGEST_ONLY_CLIENT_ID || '').trim()
const INGEST_DATE_SINCE = (process.env.INGEST_DATE_SINCE || '').trim()
const INGEST_DATE_UNTIL = (process.env.INGEST_DATE_UNTIL || '').trim()
// META_BREAKDOWNS foi removido da ingestão de campanhas.
// Breakdowns inflavam reach/impressions (o mesmo usuário contado por placement).
// A API retorna totais corretos sem breakdowns. Mantido aqui apenas como referência.
// const META_BREAKDOWNS = ...

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

if (!ENCRYPT_KEY || ENCRYPT_KEY.length < 16) {
  console.error('Missing or invalid ENCRYPT_KEY (minimum 16 characters)')
  process.exit(1)
}

// ---------- crypto helpers (mirrors lib/crypto.ts) ----------
function getDerivedKey() {
  return scryptSync(ENCRYPT_KEY, 'meta-dashboard-salt', 32)
}

function decryptToken(ciphertext) {
  const parts = ciphertext.split(':')
  if (parts.length !== 3) {
    throw new Error(`Invalid ciphertext format for token (got ${parts.length} parts)`)
  }
  const [ivHex, authTagHex, dataHex] = parts
  const key = getDerivedKey()
  const iv = Buffer.from(ivHex, 'hex')
  const authTag = Buffer.from(authTagHex, 'hex')
  const encrypted = Buffer.from(dataHex, 'hex')

  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)
  return decipher.update(encrypted).toString('utf8') + decipher.final('utf8')
}
// ------------------------------------------------------------

function extractProjectTag(campaignName) {
  if (!campaignName) return 'Sem Tag'
  const m = String(campaignName).match(/\[([^\]]+)\]/)
  return m ? m[1].trim() : 'Sem Tag'
}

function toNum(value) {
  if (value === null || value === undefined) return 0
  const n = Number(String(value).replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

function toMoneyFromMinorUnits(value) {
  return toNum(value) / 100
}

function actionValue(actions, keys) {
  if (!Array.isArray(actions)) return 0
  for (const key of keys) {
    const found = actions.find((a) => a?.action_type === key)
    if (found) return toNum(found.value)
  }
  return 0
}

const DEFAULT_LEAD_KEYS = ['lead', 'offsite_conversion.fb_pixel_lead', 'onsite_web_lead']

function buildEngagementFields(actions) {
  return {
    // post_net_like = curtidas/seguidores líquidos de página gerados pelo anúncio
    follows: actionValue(actions, ['onsite_conversion.post_net_like', 'like']),
    reactions: actionValue(actions, ['post_reaction']),
    comments_count: actionValue(actions, ['comment', 'onsite_conversion.post_net_comment']),
    shares: actionValue(actions, ['post']),
    // post_net_save = salvamentos líquidos (saves - unsaves)
    saves: actionValue(actions, ['onsite_conversion.post_net_save', 'onsite_conversion.post_save']),
    post_engagement: actionValue(actions, ['post_engagement']),
  }
}

function buildCampaignMetricRow(clientId, raw, leadActionKey, campaignBudgetById) {
  const actions = raw.actions || []
  const conversions = raw.conversions || []
  const linkClicks = actionValue(actions, ['link_click']) || toNum(raw.clicks)
  const landingPageViews = actionValue(actions, ['landing_page_view', 'omni_landing_page_view'])
  const campaignId = raw.campaign_id ? String(raw.campaign_id) : null
  const dailyBudget = campaignId ? (campaignBudgetById.get(campaignId) || 0) : 0
  const leads = leadActionKey
    ? (actionValue(conversions, [leadActionKey]) + actionValue(actions, DEFAULT_LEAD_KEYS))
    : actionValue(actions, DEFAULT_LEAD_KEYS)

  // Sem breakdown: uma linha por campanha/dia com totais corretos da API.
  // Campos de placement removidos intencionalmente para evitar dupla contagem de reach.
  return {
    client_id: clientId,
    date: raw.date_start,
    campaign_name: raw.campaign_name || '(sem campanha)',
    project_tag: extractProjectTag(raw.campaign_name),
    daily_budget: dailyBudget,
    reach: toNum(raw.reach),
    impressions: toNum(raw.impressions),
    amount_spent: toNum(raw.spend),
    link_clicks: linkClicks,
    landing_page_views: landingPageViews,
    leads: leads,
    account_name: raw.account_name || null,
    ...buildEngagementFields(actions),
  }
}

function buildAdMetricRow(clientId, raw, leadActionKey) {
  const actions = raw.actions || []
  const conversions = raw.conversions || []
  const linkClicks = actionValue(actions, ['link_click']) || toNum(raw.clicks)
  const landingPageViews = actionValue(actions, ['landing_page_view', 'omni_landing_page_view'])
  const leads = leadActionKey
    ? (actionValue(conversions, [leadActionKey]) + actionValue(actions, DEFAULT_LEAD_KEYS))
    : actionValue(actions, DEFAULT_LEAD_KEYS)

  return {
    client_id: clientId,
    date: raw.date_start,
    campaign_name: raw.campaign_name || '(sem campanha)',
    project_tag: extractProjectTag(raw.campaign_name),
    adset_id: raw.adset_id || null,
    adset_name: raw.adset_name || null,
    ad_id: raw.ad_id || null,
    ad_name: raw.ad_name || null,
    reach: toNum(raw.reach),
    impressions: toNum(raw.impressions),
    amount_spent: toNum(raw.spend),
    link_clicks: linkClicks,
    landing_page_views: landingPageViews,
    leads: leads,
    account_name: raw.account_name || null,
    ...buildEngagementFields(actions),
  }
}

async function supabaseGet(path) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
    }
  })
  if (!resp.ok) {
    throw new Error(`Supabase GET failed (${resp.status}): ${await resp.text()}`)
  }
  return resp.json()
}

async function supabaseUpsert(table, rows, onConflict) {
  if (!rows.length) return

  const url = `${SUPABASE_URL}/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`
  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'resolution=merge-duplicates,return=minimal'
  }

  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(rows)
  })

  if (resp.ok) return

  const errorText = await resp.text()

  // Compatibilidade com ambientes em que meta_daily_ad_metrics ainda não possui account_name.
  // Se esse for o único erro de schema, tenta novamente removendo o campo.
  if (
    table === 'meta_daily_ad_metrics' &&
    errorText.includes("Could not find the 'account_name' column")
  ) {
    const rowsWithoutAccountName = rows.map(({ account_name, ...rest }) => rest)
    const retry = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(rowsWithoutAccountName)
    })

    if (retry.ok) {
      console.warn('meta_daily_ad_metrics: fallback sem account_name aplicado com sucesso')
      return
    }

    throw new Error(`Supabase UPSERT failed (${retry.status}) after fallback: ${await retry.text()}`)
  }

  // Compatibilidade com ambientes em que meta_daily_campaign_metrics ainda não possui daily_budget.
  if (
    table === 'meta_daily_campaign_metrics' &&
    errorText.includes("Could not find the 'daily_budget' column")
  ) {
    const rowsWithoutDailyBudget = rows.map(({ daily_budget, ...rest }) => rest)
    const retry = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(rowsWithoutDailyBudget)
    })

    if (retry.ok) {
      console.warn('meta_daily_campaign_metrics: fallback sem daily_budget aplicado com sucesso')
      return
    }

    throw new Error(`Supabase UPSERT failed (${retry.status}) after fallback: ${await retry.text()}`)
  }

  // Compatibilidade com ambientes em que meta_ad_creatives ainda não possui ad_snapshot_url.
  if (
    table === 'meta_ad_creatives' &&
    errorText.includes("Could not find the 'ad_snapshot_url' column")
  ) {
    const rowsWithoutSnapshot = rows.map(({ ad_snapshot_url, ...rest }) => rest)
    const retry = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(rowsWithoutSnapshot)
    })

    if (retry.ok) {
      console.warn('meta_ad_creatives: fallback sem ad_snapshot_url aplicado com sucesso')
      return
    }

    throw new Error(`Supabase UPSERT failed (${retry.status}) after fallback: ${await retry.text()}`)
  }

  throw new Error(`Supabase UPSERT failed (${resp.status}): ${errorText}`)
}

// ---------- creatives ----------
async function fetchAdsWithCreatives(accessToken, adAccountId) {
  const fields = [
    'id',
    'name',
    'status',
    'adset_id',
    'campaign_id',
    'ad_snapshot_url',
    'creative.fields(id,thumbnail_url,image_url,video_id,link_url,call_to_action{type})',
  ].join(',')

  const params = new URLSearchParams({
    access_token: accessToken,
    fields,
    limit: String(META_LIMIT),
  })

  const baseUrl = `https://graph.facebook.com/${META_API_VERSION}/act_${String(adAccountId).replace(/^act_/, '')}/ads`
  let url = `${baseUrl}?${params.toString()}`
  const results = []

  while (url) {
    const resp = await fetch(url)
    const payload = await resp.json()

    if (!resp.ok || payload.error) {
      const message = payload?.error?.message || `HTTP ${resp.status}`
      throw new Error(`Meta API (creatives) error for account ${adAccountId}: ${message}`)
    }

    for (const item of payload.data || []) results.push(item)
    url = payload?.paging?.next || null
  }

  return results
}

function extractUrlFromPreviewHtml(html) {
  if (!html) return null
  const iframeSrc = String(html).match(/src=["']([^"']+)["']/i)?.[1]
  if (iframeSrc) return iframeSrc.replace(/&amp;/g, '&')

  const href = String(html).match(/href=["']([^"']+)["']/i)?.[1]
  if (href) return href.replace(/&amp;/g, '&')

  return null
}

async function fetchAdPreviewUrl(accessToken, adId) {
  const params = new URLSearchParams({
    access_token: accessToken,
    ad_format: 'DESKTOP_FEED_STANDARD'
  })

  const url = `https://graph.facebook.com/${META_API_VERSION}/${adId}/previews?${params.toString()}`
  const resp = await fetch(url)
  const payload = await resp.json()

  if (!resp.ok || payload.error) {
    return null
  }

  const firstPreview = payload?.data?.[0]
  return extractUrlFromPreviewHtml(firstPreview?.body)
}

function detectCreativeType(creative) {
  if (!creative) return 'unknown'
  if (creative.video_id) return 'video'
  if (creative.image_url || creative.thumbnail_url) return 'image'
  return 'unknown'
}

function buildCreativeRow(clientId, ad) {
  const creative = ad.creative || {}
  return {
    client_id: clientId,
    ad_id: ad.id,
    ad_name: ad.name || null,
    campaign_id: ad.campaign_id || null,
    adset_id: ad.adset_id || null,
    creative_id: creative.id || null,
    thumbnail_url: creative.thumbnail_url || creative.image_url || null,
    image_url: creative.image_url || null,
    video_id: creative.video_id || null,
    link_url: creative.link_url || null,
    ad_snapshot_url: ad.ad_snapshot_url || null,
    call_to_action_type: creative.call_to_action?.type || null,
    status: ad.status || null,
    creative_type: detectCreativeType(creative),
  }
}

async function fetchCampaignDailyBudgets(accessToken, adAccountId) {
  const params = new URLSearchParams({
    access_token: accessToken,
    fields: 'id,daily_budget',
    limit: String(META_LIMIT),
  })

  const baseUrl = `https://graph.facebook.com/${META_API_VERSION}/act_${String(adAccountId).replace(/^act_/, '')}/campaigns`
  let url = `${baseUrl}?${params.toString()}`
  const budgetByCampaignId = new Map()

  while (url) {
    const resp = await fetch(url)
    const payload = await resp.json()

    if (!resp.ok || payload.error) {
      const message = payload?.error?.message || `HTTP ${resp.status}`
      throw new Error(`Meta API (campaign budgets) error for account ${adAccountId}: ${message}`)
    }

    for (const item of payload.data || []) {
      const campaignId = item?.id ? String(item.id) : null
      if (!campaignId) continue
      budgetByCampaignId.set(campaignId, toMoneyFromMinorUnits(item.daily_budget))
    }

    url = payload?.paging?.next || null
  }

  return budgetByCampaignId
}

async function fetchAdsetDailyBudgetsByCampaign(accessToken, adAccountId) {
  const params = new URLSearchParams({
    access_token: accessToken,
    fields: 'id,campaign_id,daily_budget,effective_status',
    limit: String(META_LIMIT),
  })

  const baseUrl = `https://graph.facebook.com/${META_API_VERSION}/act_${String(adAccountId).replace(/^act_/, '')}/adsets`
  let url = `${baseUrl}?${params.toString()}`

  const activeBudgetByCampaignId = new Map()
  const anyBudgetByCampaignId = new Map()

  while (url) {
    const resp = await fetch(url)
    const payload = await resp.json()

    if (!resp.ok || payload.error) {
      const message = payload?.error?.message || `HTTP ${resp.status}`
      throw new Error(`Meta API (adset budgets) error for account ${adAccountId}: ${message}`)
    }

    for (const item of payload.data || []) {
      const campaignId = item?.campaign_id ? String(item.campaign_id) : null
      if (!campaignId) continue

      const budget = toMoneyFromMinorUnits(item.daily_budget)
      if (!(budget > 0)) continue

      const status = String(item.effective_status || '').toUpperCase()
      const isIgnoredStatus = status === 'ARCHIVED' || status === 'DELETED'
      const isActiveLike = status === 'ACTIVE' || status === 'PAUSED'

      if (!isIgnoredStatus) {
        anyBudgetByCampaignId.set(
          campaignId,
          (anyBudgetByCampaignId.get(campaignId) || 0) + budget
        )
      }

      if (isActiveLike) {
        activeBudgetByCampaignId.set(
          campaignId,
          (activeBudgetByCampaignId.get(campaignId) || 0) + budget
        )
      }
    }

    url = payload?.paging?.next || null
  }

  // Prioriza soma de adsets ativos/pausados; fallback para qualquer adset não arquivado/deletado.
  const resolved = new Map(anyBudgetByCampaignId)
  for (const [campaignId, budget] of activeBudgetByCampaignId.entries()) {
    resolved.set(campaignId, budget)
  }
  return resolved
}
// --------------------------------

function getRequestedDateRange() {
  if (!INGEST_DATE_SINCE || !INGEST_DATE_UNTIL) return null

  return {
    since: INGEST_DATE_SINCE,
    until: INGEST_DATE_UNTIL,
  }
}

async function fetchMetaInsights(accessToken, adAccountId, options = {}) {
  const level = options.level || META_LEVEL
  const datePreset = options.datePreset || META_DATE_PRESET
  const timeIncrement = options.timeIncrement || META_TIME_INCREMENT
  const breakdowns = options.breakdowns === undefined ? [] : options.breakdowns
  const requestedRange = getRequestedDateRange()

  const baseUrl = `https://graph.facebook.com/${META_API_VERSION}/act_${String(adAccountId).replace(/^act_/, '')}/insights`
  const fields = [
    'date_start',
    'date_stop',
    'account_name',
    'campaign_id',
    'campaign_name',
    'adset_id',
    'adset_name',
    'ad_id',
    'ad_name',
    'impressions',
    'reach',
    'clicks',
    'spend',
    'actions',
    'conversions'
  ].join(',')

  if (requestedRange && !options.skipChunking) {
    const allRows = []
    const chunkDays = level === 'ad' ? 30 : 90
    const globalStart = new Date(`${requestedRange.since}T00:00:00.000Z`)
    let chunkEnd = new Date(`${requestedRange.until}T00:00:00.000Z`)

    while (chunkEnd >= globalStart) {
      const tentativeStart = new Date(chunkEnd)
      tentativeStart.setUTCDate(tentativeStart.getUTCDate() - (chunkDays - 1))
      const chunkStart = tentativeStart < globalStart ? new Date(globalStart) : tentativeStart
      const since = chunkStart.toISOString().slice(0, 10)
      const until = chunkEnd.toISOString().slice(0, 10)

      const chunkParams = new URLSearchParams({
        access_token: accessToken,
        level,
        fields,
        limit: String(META_LIMIT),
        time_increment: String(timeIncrement),
        time_range: JSON.stringify({ since, until })
      })
      if (Array.isArray(breakdowns) && breakdowns.length > 0) {
        chunkParams.set('breakdowns', breakdowns.join(','))
      }

      let url = `${baseUrl}?${chunkParams.toString()}`
      while (url) {
        const resp = await fetch(url)
        const payload = await resp.json()
        if (!resp.ok || payload.error) {
          const message = payload?.error?.message || `HTTP ${resp.status}`
          throw new Error(`Meta API error for account ${adAccountId}: ${message}`)
        }
        for (const item of payload.data || []) allRows.push(item)
        url = payload?.paging?.next || null
      }

      const previousDay = new Date(chunkStart)
      previousDay.setUTCDate(previousDay.getUTCDate() - 1)
      chunkEnd = previousDay
    }

    return allRows
  }

  // Se META_DAYS_BACK estiver configurado, divide em chunks de 90 dias (só para campaign)
  if (META_DAYS_BACK > 0 && !options.skipChunking) {
    const allRows = []
    const chunkDays = 90
    const now = new Date()
    let chunkEnd = new Date(now)

    while (true) {
      const chunkStart = new Date(chunkEnd.getTime() - chunkDays * 86400 * 1000)
      const globalStart = new Date(now.getTime() - META_DAYS_BACK * 86400 * 1000)
      const since = (chunkStart < globalStart ? globalStart : chunkStart).toISOString().slice(0, 10)
      const until = chunkEnd.toISOString().slice(0, 10)

      const chunkParams = new URLSearchParams({
        access_token: accessToken,
        level,
        fields,
        limit: String(META_LIMIT),
        time_increment: String(timeIncrement),
        time_range: JSON.stringify({ since, until })
      })
      if (Array.isArray(breakdowns) && breakdowns.length > 0) {
        chunkParams.set('breakdowns', breakdowns.join(','))
      }

      let url = `${baseUrl}?${chunkParams.toString()}`
      while (url) {
        const resp = await fetch(url)
        const payload = await resp.json()
        if (!resp.ok || payload.error) {
          const message = payload?.error?.message || `HTTP ${resp.status}`
          throw new Error(`Meta API error for account ${adAccountId}: ${message}`)
        }
        for (const item of payload.data || []) allRows.push(item)
        url = payload?.paging?.next || null
      }

      if (chunkStart <= globalStart) break
      chunkEnd = new Date(chunkStart.getTime() - 86400 * 1000) // recua 1 dia para não sobrepor
    }

    return allRows
  }

  const params = new URLSearchParams({
    access_token: accessToken,
    level,
    fields,
    limit: String(META_LIMIT),
    time_increment: String(timeIncrement)
  })

  if (requestedRange) {
    params.set('time_range', JSON.stringify(requestedRange))
  } else {
    params.set('date_preset', datePreset)
  }

  if (Array.isArray(breakdowns) && breakdowns.length > 0) {
    params.set('breakdowns', breakdowns.join(','))
  }

  let url = `${baseUrl}?${params.toString()}`
  const rows = []

  while (url) {
    const resp = await fetch(url)
    const payload = await resp.json()

    if (!resp.ok || payload.error) {
      const message = payload?.error?.message || `HTTP ${resp.status}`
      throw new Error(`Meta API error for account ${adAccountId}: ${message}`)
    }

    for (const item of payload.data || []) {
      rows.push(item)
    }

    url = payload?.paging?.next || null
  }

  return rows
}

async function main() {
  console.log('Loading active credentials and accounts...')

  const credentials = await supabaseGet('client_meta_credentials?select=client_id,access_token,is_active&is_active=eq.true')
  const accounts = await supabaseGet('client_ad_accounts?select=client_id,ad_account_id,is_active&is_active=eq.true')
  const clientConfigs = await supabaseGet('clients?select=id,lead_action_key')
  const leadActionKeyByClient = new Map(clientConfigs.map((c) => [c.id, c.lead_action_key || null]))

  const tokenByClient = new Map()

  for (const c of credentials) {
    try {
      tokenByClient.set(c.client_id, decryptToken(c.access_token))
    } catch (err) {
      console.error(`client ${c.client_id}: failed to decrypt token —`, err.message)
      tokenByClient.set(c.client_id, null)
    }
  }
  const accountsByClient = new Map()

  for (const acc of accounts) {
    if (!accountsByClient.has(acc.client_id)) accountsByClient.set(acc.client_id, [])
    accountsByClient.get(acc.client_id).push(acc.ad_account_id)
  }

  let totalSent = 0
  const clientFailures = []

  for (const [clientId, accessToken] of tokenByClient.entries()) {
    if (INGEST_ONLY_CLIENT_ID && clientId !== INGEST_ONLY_CLIENT_ID) {
      continue
    }
    if (!accessToken) {
      console.warn(`client ${clientId}: skipping — token could not be decrypted`)
      clientFailures.push({ clientId, reason: 'token_decrypt_failed' })
      continue
    }

    const clientAccounts = accountsByClient.get(clientId) || []
    if (!clientAccounts.length) {
      console.log(`client ${clientId}: no ad accounts, skipping`)
      clientFailures.push({ clientId, reason: 'no_active_ad_accounts' })
      continue
    }

    console.log(`client ${clientId}: ${clientAccounts.length} account(s)`) 

    try {
      const campaignRows = []
      const adRows = []
      let insightsFailedAccounts = 0

      const leadActionKey = leadActionKeyByClient.get(clientId) || null
      if (leadActionKey) console.log(`client ${clientId}: using custom lead action key "${leadActionKey}"`)

      for (const adAccountId of clientAccounts) {
        try {
          const campaignBudgetById = new Map()
          try {
            const fetchedCampaignBudgets = await fetchCampaignDailyBudgets(accessToken, adAccountId)
            for (const [campaignId, budget] of fetchedCampaignBudgets.entries()) {
              campaignBudgetById.set(campaignId, budget)
            }
          } catch (err) {
            console.warn(`  account ${adAccountId}: campaign budgets unavailable — ${err.message}`)
          }

          try {
            const adsetBudgetByCampaignId = await fetchAdsetDailyBudgetsByCampaign(accessToken, adAccountId)
            for (const [campaignId, adsetBudget] of adsetBudgetByCampaignId.entries()) {
              const campaignBudget = campaignBudgetById.get(campaignId) || 0
              if (campaignBudget <= 0 && adsetBudget > 0) {
                campaignBudgetById.set(campaignId, adsetBudget)
              }
            }
          } catch (err) {
            console.warn(`  account ${adAccountId}: adset budgets unavailable — ${err.message}`)
          }

          // Sem breakdowns: garante um total único por campanha/dia com reach correto
          const campaignInsights = await fetchMetaInsights(accessToken, adAccountId, {
            level: META_LEVEL,
            breakdowns: []
          })
          for (const row of campaignInsights) {
            campaignRows.push(buildCampaignMetricRow(clientId, row, leadActionKey, campaignBudgetById))
          }

          const adInsights = await fetchMetaInsights(accessToken, adAccountId, {
            level: META_AD_LEVEL,
            breakdowns: [],
          })
          for (const row of adInsights) adRows.push(buildAdMetricRow(clientId, row, leadActionKey))
        } catch (err) {
          insightsFailedAccounts++
          console.warn(`  account ${adAccountId}: insights fetch failed — ${err.message}`)
        }
      }

      if (insightsFailedAccounts === clientAccounts.length) {
        throw new Error('all ad accounts failed while fetching insights')
      }

      // Deduplica por chave de conflito — soma métricas de linhas com mesma campanha/data
      const campaignMap = new Map()
      for (const row of campaignRows) {
        const key = `${row.date}|${row.campaign_name}|${row.project_tag}`
        if (!campaignMap.has(key)) { campaignMap.set(key, { ...row }); continue }
        const existing = campaignMap.get(key)
        for (const field of ['daily_budget','reach','impressions','amount_spent','link_clicks','landing_page_views','leads','follows','reactions','comments_count','shares','saves','post_engagement']) {
          existing[field] = (existing[field] || 0) + (row[field] || 0)
        }
      }
      const dedupedCampaignRows = [...campaignMap.values()]
      await supabaseUpsert('meta_daily_campaign_metrics', dedupedCampaignRows, 'client_id,date,campaign_name,project_tag')
      totalSent += dedupedCampaignRows.length

      let upsertedAdRows = 0
      try {
        const validAdRows = adRows.filter((r) => r.ad_id)
        await supabaseUpsert('meta_daily_ad_metrics', validAdRows, 'client_id,date,ad_id')
        upsertedAdRows = validAdRows.length
        totalSent += upsertedAdRows
      } catch (err) {
        console.warn(`client ${clientId}: ad metrics upsert skipped — ${err.message}`)
      }

      console.log(`client ${clientId}: upserted campaign=${campaignRows.length} ad=${upsertedAdRows}`)

      // Criativos
      console.log(`client ${clientId}: fetching creatives...`)
      const creativeRows = []
      for (const adAccountId of clientAccounts) {
        try {
          const ads = await fetchAdsWithCreatives(accessToken, adAccountId)
          let previewsRecovered = 0

          for (const ad of ads) {
            const row = buildCreativeRow(clientId, ad)

            // Fallback para link público: busca preview do anúncio quando a API não retorna
            // ad_snapshot_url/link_url diretamente no endpoint de ads.
            if (!row.ad_snapshot_url && row.ad_id) {
              const previewUrl = await fetchAdPreviewUrl(accessToken, row.ad_id)
              if (previewUrl) {
                row.ad_snapshot_url = previewUrl
                previewsRecovered++
              }
            }

            if (row.thumbnail_url || row.image_url || row.video_id) creativeRows.push(row)
          }

          console.log(`  account ${adAccountId}: ${ads.length} ads with creatives (${previewsRecovered} preview links recovered)`)
        } catch (err) {
          console.warn(`  account ${adAccountId}: creatives fetch failed — ${err.message}`)
        }
      }

      if (creativeRows.length > 0) {
        await supabaseUpsert('meta_ad_creatives', creativeRows, 'client_id,ad_id')
        console.log(`client ${clientId}: upserted ${creativeRows.length} creatives`)
        totalSent += creativeRows.length
      } else {
        console.log(`client ${clientId}: no creatives with media found`)
      }

    await revalidateClientCache(clientId)
    } catch (err) {
      clientFailures.push({ clientId, reason: err.message })
      console.error(`client ${clientId}: FAILED — ${err.message} — pulando para o próximo cliente`)
    }
  }

  if (INGEST_ONLY_CLIENT_ID && !tokenByClient.has(INGEST_ONLY_CLIENT_ID)) {
    console.warn(`INGEST_ONLY_CLIENT_ID=${INGEST_ONLY_CLIENT_ID} não encontrado em client_meta_credentials ativos`)
  }

  if (clientFailures.length > 0) {
    console.error('Clients with failures:')
    for (const failure of clientFailures) {
      console.error(` - ${failure.clientId}: ${failure.reason}`)
    }

    throw new Error(`Ingest finished with failures in ${clientFailures.length} client(s)`)
  }

  console.log(`Done. Total rows upserted: ${totalSent}`)
}

async function revalidateClientCache(clientId) {
  if (!REVALIDATE_SECRET) {
    console.log(`client ${clientId}: REVALIDATE_SECRET not set, skipping cache revalidation`)
    return
  }

  if (!APP_BASE_URL) {
    console.log(`client ${clientId}: APP URL not set, skipping cache revalidation`)
    return
  }

  try {
    const resp = await fetch(`${APP_BASE_URL}/api/revalidate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${REVALIDATE_SECRET}`
      },
      body: JSON.stringify({ clientId })
    })

    if (resp.ok) {
      console.log(`client ${clientId}: cache revalidated`)
    } else {
      console.warn(`client ${clientId}: cache revalidation failed (${resp.status})`)
    }
  } catch (err) {
    console.warn(`client ${clientId}: cache revalidation skipped (${err.message})`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
