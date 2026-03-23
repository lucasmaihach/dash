import { createDecipheriv, scryptSync } from 'crypto'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ENCRYPT_KEY = process.env.ENCRYPT_KEY

const GOOGLE_ADS_DEVELOPER_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN
const GOOGLE_ADS_CLIENT_ID = process.env.GOOGLE_ADS_CLIENT_ID
const GOOGLE_ADS_CLIENT_SECRET = process.env.GOOGLE_ADS_CLIENT_SECRET

const GOOGLE_API_VERSION = process.env.GOOGLE_API_VERSION || 'v17'
const GOOGLE_DATE_RANGE = process.env.GOOGLE_DATE_RANGE || 'LAST_30_DAYS'
const INGEST_ONLY_CLIENT_ID = (process.env.INGEST_ONLY_CLIENT_ID || '').trim()

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

if (!ENCRYPT_KEY || ENCRYPT_KEY.length < 16) {
  console.error('Missing or invalid ENCRYPT_KEY (minimum 16 characters)')
  process.exit(1)
}

if (!GOOGLE_ADS_DEVELOPER_TOKEN || !GOOGLE_ADS_CLIENT_ID || !GOOGLE_ADS_CLIENT_SECRET) {
  console.error('Missing GOOGLE_ADS_DEVELOPER_TOKEN / GOOGLE_ADS_CLIENT_ID / GOOGLE_ADS_CLIENT_SECRET')
  process.exit(1)
}

function getDerivedKey() {
  return scryptSync(ENCRYPT_KEY, 'meta-dashboard-salt', 32)
}

function decryptToken(ciphertext) {
  const parts = String(ciphertext || '').split(':')
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

function toNum(value) {
  if (value === null || value === undefined) return 0
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function microsToCurrency(microsValue) {
  return toNum(microsValue) / 1_000_000
}

function extractProjectTag(name) {
  if (!name) return 'Sem Tag'
  const m = String(name).match(/\[([^\]]+)\]/)
  return m ? m[1].trim() : 'Sem Tag'
}

function normalizeCustomerId(customerId) {
  return String(customerId || '').replace(/-/g, '')
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
  const resp = await fetch(url, {
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

async function fetchGoogleAccessToken(refreshToken) {
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_ADS_CLIENT_ID,
      client_secret: GOOGLE_ADS_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    })
  })

  const payload = await resp.json()
  if (!resp.ok || payload.error) {
    const message = payload?.error_description || payload?.error || `HTTP ${resp.status}`
    throw new Error(`Google OAuth token error: ${message}`)
  }

  return payload.access_token
}

async function googleAdsSearchStream({ accessToken, customerId, loginCustomerId, query }) {
  const normalizedCustomerId = normalizeCustomerId(customerId)
  const url = `https://googleads.googleapis.com/${GOOGLE_API_VERSION}/customers/${normalizedCustomerId}/googleAds:searchStream`

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': GOOGLE_ADS_DEVELOPER_TOKEN,
    'Content-Type': 'application/json'
  }

  if (loginCustomerId) {
    headers['login-customer-id'] = normalizeCustomerId(loginCustomerId)
  }

  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query })
  })

  const payload = await resp.json()
  if (!resp.ok || payload.error) {
    const details = payload?.error?.message || payload?.error?.details?.[0]?.errors?.[0]?.message || `HTTP ${resp.status}`
    throw new Error(`Google Ads API error (${normalizedCustomerId}): ${details}`)
  }

  const rows = []
  for (const chunk of payload || []) {
    for (const row of chunk.results || []) rows.push(row)
  }
  return rows
}

function buildCampaignMetricRow(clientId, customerId, raw) {
  const campaignName = raw?.campaign?.name || '(sem campanha)'
  return {
    client_id: clientId,
    date: raw?.segments?.date,
    campaign_id: raw?.campaign?.id ? String(raw.campaign.id) : null,
    campaign_name: campaignName,
    project_tag: extractProjectTag(campaignName),
    impressions: toNum(raw?.metrics?.impressions),
    clicks: toNum(raw?.metrics?.clicks),
    amount_spent: microsToCurrency(raw?.metrics?.costMicros),
    conversions: toNum(raw?.metrics?.conversions),
    leads: toNum(raw?.metrics?.conversions),
    account_name: raw?.customer?.descriptiveName || null,
    customer_id: normalizeCustomerId(customerId)
  }
}

function buildAdMetricRow(clientId, customerId, raw) {
  const campaignName = raw?.campaign?.name || '(sem campanha)'
  return {
    client_id: clientId,
    date: raw?.segments?.date,
    campaign_id: raw?.campaign?.id ? String(raw.campaign.id) : null,
    campaign_name: campaignName,
    project_tag: extractProjectTag(campaignName),
    ad_group_id: raw?.adGroup?.id ? String(raw.adGroup.id) : null,
    ad_group_name: raw?.adGroup?.name || null,
    ad_id: raw?.adGroupAd?.ad?.id ? String(raw.adGroupAd.ad.id) : null,
    ad_name: raw?.adGroupAd?.ad?.name || null,
    impressions: toNum(raw?.metrics?.impressions),
    clicks: toNum(raw?.metrics?.clicks),
    amount_spent: microsToCurrency(raw?.metrics?.costMicros),
    conversions: toNum(raw?.metrics?.conversions),
    leads: toNum(raw?.metrics?.conversions),
    customer_id: normalizeCustomerId(customerId),
    account_name: raw?.customer?.descriptiveName || null
  }
}

async function main() {
  console.log('Loading active Google credentials and accounts...')

  const credentials = await supabaseGet('client_google_credentials?select=client_id,refresh_token,manager_customer_id,is_active&is_active=eq.true')
  const accounts = await supabaseGet('client_google_ad_accounts?select=client_id,customer_id,is_active&is_active=eq.true')

  const refreshTokenByClient = new Map(
    credentials.map((c) => {
      try {
        return [
          c.client_id,
          {
            refreshToken: decryptToken(c.refresh_token),
            managerCustomerId: c.manager_customer_id || null,
          },
        ]
      } catch (err) {
        console.error(`client ${c.client_id}: failed to decrypt Google refresh token — ${err.message}`)
        return [c.client_id, null]
      }
    })
  )

  const accountsByClient = new Map()
  for (const acc of accounts) {
    if (!accountsByClient.has(acc.client_id)) accountsByClient.set(acc.client_id, [])
    accountsByClient.get(acc.client_id).push(acc.customer_id)
  }

  let totalUpserted = 0

  for (const [clientId, cred] of refreshTokenByClient.entries()) {
    if (INGEST_ONLY_CLIENT_ID && clientId !== INGEST_ONLY_CLIENT_ID) continue

    if (!cred?.refreshToken) {
      console.warn(`client ${clientId}: skipping — refresh token unavailable`)
      continue
    }

    const clientAccounts = accountsByClient.get(clientId) || []
    if (!clientAccounts.length) {
      console.log(`client ${clientId}: no Google Ads accounts, skipping`)
      continue
    }

    try {
      const accessToken = await fetchGoogleAccessToken(cred.refreshToken)
      const campaignRows = []
      const adRows = []

      for (const customerId of clientAccounts) {
        const campaignQuery = `
          SELECT
            segments.date,
            customer.descriptive_name,
            campaign.id,
            campaign.name,
            metrics.impressions,
            metrics.clicks,
            metrics.cost_micros,
            metrics.conversions
          FROM campaign
          WHERE segments.date DURING ${GOOGLE_DATE_RANGE}
        `

        const adQuery = `
          SELECT
            segments.date,
            customer.descriptive_name,
            campaign.id,
            campaign.name,
            ad_group.id,
            ad_group.name,
            ad_group_ad.ad.id,
            ad_group_ad.ad.name,
            metrics.impressions,
            metrics.clicks,
            metrics.cost_micros,
            metrics.conversions
          FROM ad_group_ad
          WHERE segments.date DURING ${GOOGLE_DATE_RANGE}
        `

        const rawCampaignRows = await googleAdsSearchStream({
          accessToken,
          customerId,
          loginCustomerId: cred.managerCustomerId,
          query: campaignQuery
        })

        const rawAdRows = await googleAdsSearchStream({
          accessToken,
          customerId,
          loginCustomerId: cred.managerCustomerId,
          query: adQuery
        })

        for (const raw of rawCampaignRows) campaignRows.push(buildCampaignMetricRow(clientId, customerId, raw))
        for (const raw of rawAdRows) adRows.push(buildAdMetricRow(clientId, customerId, raw))

        console.log(`  customer ${customerId}: campaign=${rawCampaignRows.length} ad=${rawAdRows.length}`)
      }

      await supabaseUpsert('google_daily_campaign_metrics', campaignRows.filter((r) => r.date && r.campaign_id), 'client_id,date,campaign_id')
      await supabaseUpsert('google_daily_ad_metrics', adRows.filter((r) => r.date && r.ad_id), 'client_id,date,ad_id')

      totalUpserted += campaignRows.length + adRows.length
      console.log(`client ${clientId}: upserted campaign=${campaignRows.length} ad=${adRows.length}`)
    } catch (err) {
      console.error(`client ${clientId}: FAILED — ${err.message}`)
    }
  }

  if (INGEST_ONLY_CLIENT_ID && !refreshTokenByClient.has(INGEST_ONLY_CLIENT_ID)) {
    console.warn(`INGEST_ONLY_CLIENT_ID=${INGEST_ONLY_CLIENT_ID} não encontrado em client_google_credentials ativos`)
  }

  console.log(`Done. Total rows upserted: ${totalUpserted}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
