/**
 * scripts/ingest_meta_ad_creatives.mjs
 *
 * Busca dados de criativos (thumbnail, tipo, link) para cada anúncio ativo
 * e faz upsert em public.meta_ad_creatives.
 *
 * Execute após a ingestão principal:
 *   node scripts/ingest_meta_ad_creatives.mjs
 *
 * Ou adicione ao cron logo após ingest_meta_to_supabase.mjs.
 */

import { createDecipheriv, scryptSync } from 'crypto'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ENCRYPT_KEY = process.env.ENCRYPT_KEY
const META_API_VERSION = process.env.META_API_VERSION || 'v21.0'
const META_LIMIT = Number(process.env.META_LIMIT || '500')

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

if (!ENCRYPT_KEY || ENCRYPT_KEY.length < 16) {
  console.error('Missing or invalid ENCRYPT_KEY')
  process.exit(1)
}

// ---------- crypto ----------
function getDerivedKey() {
  return scryptSync(ENCRYPT_KEY, 'meta-dashboard-salt', 32)
}

function decryptToken(ciphertext) {
  const parts = ciphertext.split(':')
  if (parts.length !== 3) throw new Error('Invalid ciphertext format')
  const [ivHex, authTagHex, dataHex] = parts
  const key = getDerivedKey()
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'))
  return decipher.update(Buffer.from(dataHex, 'hex')).toString('utf8') + decipher.final('utf8')
}
// ----------------------------

async function supabaseGet(path) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
  })
  if (!resp.ok) throw new Error(`Supabase GET failed (${resp.status}): ${await resp.text()}`)
  return resp.json()
}

async function supabaseUpsert(table, rows, onConflict) {
  if (!rows.length) return

  const url = `${SUPABASE_URL}/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`
  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'resolution=merge-duplicates,return=minimal',
  }

  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(rows),
  })

  if (resp.ok) return

  const errorText = await resp.text()

  if (
    table === 'meta_ad_creatives' &&
    errorText.includes("Could not find the 'ad_snapshot_url' column")
  ) {
    const rowsWithoutSnapshot = rows.map(({ ad_snapshot_url, ...rest }) => rest)
    const retry = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(rowsWithoutSnapshot),
    })

    if (retry.ok) {
      console.warn('meta_ad_creatives: fallback sem ad_snapshot_url aplicado com sucesso')
      return
    }

    throw new Error(`Supabase UPSERT failed (${retry.status}) after fallback: ${await retry.text()}`)
  }

  throw new Error(`Supabase UPSERT failed (${resp.status}): ${errorText}`)
}

/**
 * Busca todos os ads de uma conta com dados de criativo.
 * Campos:
 *   - id, name, status
 *   - adset_id, adset_name (via adset)
 *   - campaign_id, campaign_name (via campaign)
 *   - creative: thumbnail_url, image_url, video_id, link_url, call_to_action_type
 */
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
      throw new Error(`Meta API error for account ${adAccountId}: ${message}`)
    }

    for (const item of payload.data || []) {
      results.push(item)
    }

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
  const callToAction = creative.call_to_action?.type || null

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
    call_to_action_type: callToAction,
    status: ad.status || null,
    creative_type: detectCreativeType(creative),
  }
}

async function main() {
  console.log('Loading credentials and accounts...')

  const credentials = await supabaseGet(
    'client_meta_credentials?select=client_id,access_token,is_active&is_active=eq.true'
  )
  const accounts = await supabaseGet(
    'client_ad_accounts?select=client_id,ad_account_id,is_active&is_active=eq.true'
  )

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

  let totalUpserted = 0

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

    console.log(`client ${clientId}: fetching creatives for ${clientAccounts.length} account(s)`)

    const creativeRows = []

    for (const adAccountId of clientAccounts) {
      try {
        const ads = await fetchAdsWithCreatives(accessToken, adAccountId)
        let previewsRecovered = 0

        for (const ad of ads) {
          const row = buildCreativeRow(clientId, ad)

          if (!row.ad_snapshot_url && row.ad_id) {
            const previewUrl = await fetchAdPreviewUrl(accessToken, row.ad_id)
            if (previewUrl) {
              row.ad_snapshot_url = previewUrl
              previewsRecovered++
            }
          }

          // Só salva se tiver pelo menos thumbnail
          if (row.thumbnail_url || row.image_url || row.video_id) {
            creativeRows.push(row)
          }
        }
        console.log(`  account ${adAccountId}: ${ads.length} ads fetched (${previewsRecovered} preview links recovered)`)
      } catch (err) {
        console.error(`  account ${adAccountId}: ERROR — ${err.message}`)
      }
    }

    if (creativeRows.length > 0) {
      await supabaseUpsert('meta_ad_creatives', creativeRows, 'client_id,ad_id')
      totalUpserted += creativeRows.length
      console.log(`client ${clientId}: upserted ${creativeRows.length} creatives`)
    } else {
      console.log(`client ${clientId}: no creatives with media found`)
    }
  }

  console.log(`Done. Total creatives upserted: ${totalUpserted}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
