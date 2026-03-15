import { createDecipheriv, scryptSync } from 'crypto'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ENCRYPT_KEY = process.env.ENCRYPT_KEY
const REVALIDATE_SECRET = process.env.REVALIDATE_SECRET
const NEXT_PUBLIC_APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
const META_API_VERSION = process.env.META_API_VERSION || 'v21.0'
const META_DATE_PRESET = process.env.META_DATE_PRESET || 'last_30d'
const META_LEVEL = process.env.META_LEVEL || 'campaign'
const META_AD_LEVEL = process.env.META_AD_LEVEL || 'ad'
const META_TIME_INCREMENT = process.env.META_TIME_INCREMENT || '1'
const META_LIMIT = Number(process.env.META_LIMIT || '500')
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

function actionValue(actions, keys) {
  if (!Array.isArray(actions)) return 0
  for (const key of keys) {
    const found = actions.find((a) => a?.action_type === key)
    if (found) return toNum(found.value)
  }
  return 0
}

function buildCampaignMetricRow(clientId, raw) {
  const actions = raw.actions || []
  const linkClicks = actionValue(actions, ['link_click']) || toNum(raw.clicks)
  const landingPageViews = actionValue(actions, ['landing_page_view', 'omni_landing_page_view'])
  const leads = actionValue(actions, ['lead', 'offsite_conversion.fb_pixel_lead', 'onsite_web_lead'])

  // Sem breakdown: uma linha por campanha/dia com totais corretos da API.
  // Campos de placement removidos intencionalmente para evitar dupla contagem de reach.
  return {
    client_id: clientId,
    date: raw.date_start,
    campaign_name: raw.campaign_name || '(sem campanha)',
    project_tag: extractProjectTag(raw.campaign_name),
    reach: toNum(raw.reach),
    impressions: toNum(raw.impressions),
    amount_spent: toNum(raw.spend),
    link_clicks: linkClicks,
    landing_page_views: landingPageViews,
    leads: leads,
    account_name: raw.account_name || null
  }
}

function buildAdMetricRow(clientId, raw) {
  const actions = raw.actions || []
  const linkClicks = actionValue(actions, ['link_click']) || toNum(raw.clicks)
  const landingPageViews = actionValue(actions, ['landing_page_view', 'omni_landing_page_view'])
  const leads = actionValue(actions, ['lead', 'offsite_conversion.fb_pixel_lead', 'onsite_web_lead'])

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
    account_name: raw.account_name || null
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
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify(rows)
  })

  if (!resp.ok) {
    throw new Error(`Supabase UPSERT failed (${resp.status}): ${await resp.text()}`)
  }
}

// ---------- creatives ----------
async function fetchAdsWithCreatives(accessToken, adAccountId) {
  const fields = [
    'id',
    'name',
    'status',
    'adset_id',
    'campaign_id',
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
    call_to_action_type: creative.call_to_action?.type || null,
    status: ad.status || null,
    creative_type: detectCreativeType(creative),
  }
}
// --------------------------------

async function fetchMetaInsights(accessToken, adAccountId, options = {}) {
  const level = options.level || META_LEVEL
  const datePreset = options.datePreset || META_DATE_PRESET
  const timeIncrement = options.timeIncrement || META_TIME_INCREMENT
  const breakdowns = options.breakdowns === undefined ? META_BREAKDOWNS : options.breakdowns

  const baseUrl = `https://graph.facebook.com/${META_API_VERSION}/act_${String(adAccountId).replace(/^act_/, '')}/insights`
  const fields = [
    'date_start',
    'date_stop',
    'account_name',
    'campaign_name',
    'adset_id',
    'adset_name',
    'ad_id',
    'ad_name',
    'impressions',
    'reach',
    'clicks',
    'spend',
    'actions'
  ].join(',')

  const params = new URLSearchParams({
    access_token: accessToken,
    level,
    fields,
    limit: String(META_LIMIT),
    date_preset: datePreset,
    time_increment: String(timeIncrement)
  })

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

  const tokenByClient = new Map(
    credentials.map((c) => {
      try {
        return [c.client_id, decryptToken(c.access_token)]
      } catch (err) {
        console.error(`client ${c.client_id}: failed to decrypt token —`, err.message)
        return [c.client_id, null]
      }
    })
  )
  const accountsByClient = new Map()

  for (const acc of accounts) {
    if (!accountsByClient.has(acc.client_id)) accountsByClient.set(acc.client_id, [])
    accountsByClient.get(acc.client_id).push(acc.ad_account_id)
  }

  let totalSent = 0

  for (const [clientId, accessToken] of tokenByClient.entries()) {
    if (!accessToken) {
      console.warn(`client ${clientId}: skipping — token could not be decrypted`)
      continue
    }

    const clientAccounts = accountsByClient.get(clientId) || []
    if (!clientAccounts.length) {
      console.log(`client ${clientId}: no ad accounts, skipping`)
      continue
    }

    console.log(`client ${clientId}: ${clientAccounts.length} account(s)`) 

    try {
      const campaignRows = []
      const adRows = []

      for (const adAccountId of clientAccounts) {
        try {
          // Sem breakdowns: garante um total único por campanha/dia com reach correto
          const campaignInsights = await fetchMetaInsights(accessToken, adAccountId, {
            level: META_LEVEL,
            breakdowns: []
          })
          for (const row of campaignInsights) campaignRows.push(buildCampaignMetricRow(clientId, row))

          const adInsights = await fetchMetaInsights(accessToken, adAccountId, {
            level: META_AD_LEVEL,
            breakdowns: []
          })
          for (const row of adInsights) adRows.push(buildAdMetricRow(clientId, row))
        } catch (err) {
          console.warn(`  account ${adAccountId}: insights fetch failed — ${err.message}`)
        }
      }

      await supabaseUpsert('meta_daily_campaign_metrics', campaignRows, 'client_id,date,campaign_name,project_tag')
      await supabaseUpsert('meta_daily_ad_metrics', adRows.filter((r) => r.ad_id), 'client_id,date,ad_id')
      totalSent += campaignRows.length + adRows.length
      console.log(`client ${clientId}: upserted campaign=${campaignRows.length} ad=${adRows.length}`)

      // Criativos
      console.log(`client ${clientId}: fetching creatives...`)
      const creativeRows = []
      for (const adAccountId of clientAccounts) {
        try {
          const ads = await fetchAdsWithCreatives(accessToken, adAccountId)
          for (const ad of ads) {
            const row = buildCreativeRow(clientId, ad)
            if (row.thumbnail_url || row.image_url || row.video_id) creativeRows.push(row)
          }
          console.log(`  account ${adAccountId}: ${ads.length} ads with creatives`)
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
      console.error(`client ${clientId}: FAILED — ${err.message} — pulando para o próximo cliente`)
    }
  }

  console.log(`Done. Total rows upserted: ${totalSent}`)
}

async function revalidateClientCache(clientId) {
  if (!REVALIDATE_SECRET) {
    console.log(`client ${clientId}: REVALIDATE_SECRET not set, skipping cache revalidation`)
    return
  }

  try {
    const resp = await fetch(`${NEXT_PUBLIC_APP_URL}/api/revalidate`, {
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
    console.warn(`client ${clientId}: cache revalidation error —`, err.message)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
