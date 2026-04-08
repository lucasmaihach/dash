import { createDecipheriv, createCipheriv, randomBytes, scryptSync } from 'crypto'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ENCRYPT_KEY = process.env.ENCRYPT_KEY

const RD_CLIENT_ID = process.env.RD_CLIENT_ID
const RD_CLIENT_SECRET = process.env.RD_CLIENT_SECRET

const INGEST_ONLY_CLIENT_ID = (process.env.INGEST_ONLY_CLIENT_ID || '').trim()
const RD_LEADS_SEGMENT_NAME = (process.env.RD_LEADS_SEGMENT_NAME || 'LEADS_30D_IOX').trim()
const RD_MQL_SEGMENT_NAME = (process.env.RD_MQL_SEGMENT_NAME || 'G77 - Qualificado 25k').trim()
const RD_MQL_BUDGET_THRESHOLD = Number(process.env.RD_MQL_BUDGET_THRESHOLD || '25000')

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

if (!ENCRYPT_KEY || ENCRYPT_KEY.length < 16) {
  console.error('Missing or invalid ENCRYPT_KEY (minimum 16 characters)')
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

function encryptToken(plaintext) {
  const key = getDerivedKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(String(plaintext || ''), 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return [iv.toString('hex'), authTag.toString('hex'), encrypted.toString('hex')].join(':')
}

function normalizeSegmentName(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

async function supabaseGet(path) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
  })

  if (!resp.ok) {
    throw new Error(`Supabase GET failed (${resp.status}): ${await resp.text()}`)
  }

  return resp.json()
}

async function supabaseUpsert(table, rows, onConflict) {
  if (!rows.length) return

  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`,
    {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(rows),
    }
  )

  if (!resp.ok) {
    throw new Error(`Supabase UPSERT failed (${resp.status}): ${await resp.text()}`)
  }
}

async function supabasePatch(path, payload) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(payload),
  })

  if (!resp.ok) {
    throw new Error(`Supabase PATCH failed (${resp.status}): ${await resp.text()}`)
  }
}

async function backfillMissingCreatedAtWithImportedAt(clientId) {
  const missing = await supabaseGet(
    `rd_leads_30d?select=rd_contact_uuid,imported_at&client_id=eq.${clientId}&created_at_rd=is.null`
  )

  let patched = 0
  for (const row of missing) {
    if (!row?.rd_contact_uuid || !row?.imported_at) continue
    await supabasePatch(
      `rd_leads_30d?client_id=eq.${clientId}&rd_contact_uuid=eq.${encodeURIComponent(row.rd_contact_uuid)}`,
      { created_at_rd: row.imported_at }
    )
    patched += 1
  }

  return patched
}

async function supabaseDelete(path) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'DELETE',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      Prefer: 'return=minimal',
    },
  })

  if (!resp.ok) {
    throw new Error(`Supabase DELETE failed (${resp.status}): ${await resp.text()}`)
  }
}

async function refreshRdAccessToken(refreshToken) {
  if (!RD_CLIENT_ID || !RD_CLIENT_SECRET) {
    throw new Error('Missing RD_CLIENT_ID or RD_CLIENT_SECRET for token refresh')
  }

  const resp = await fetch('https://api.rd.services/auth/token', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      client_id: RD_CLIENT_ID,
      client_secret: RD_CLIENT_SECRET,
      refresh_token: refreshToken,
    }),
  })

  const payload = await resp.json()
  if (!resp.ok || !payload?.access_token) {
    const reason = payload?.error_description || payload?.error || `HTTP ${resp.status}`
    throw new Error(`RD refresh token failed: ${reason}`)
  }

  return {
    accessToken: String(payload.access_token),
    refreshToken: String(payload.refresh_token || refreshToken),
    expiresIn: Number(payload.expires_in || 0) || null,
  }
}

async function rdGet(path, accessToken, query = {}) {
  const url = new URL(`https://api.rd.services${path}`)
  for (const [k, v] of Object.entries(query)) {
    if (v === null || v === undefined || v === '') continue
    url.searchParams.set(k, String(v))
  }

  const resp = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      accept: 'application/json',
    },
  })

  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`RD GET failed (${resp.status}) ${path}: ${text}`)
  }

  return resp.json()
}

function decodeTrafficSource(encodedValue) {
  const raw = String(encodedValue || '')
  if (!raw.startsWith('encoded_')) return null

  try {
    const base64 = raw.slice('encoded_'.length)
    const jsonText = Buffer.from(base64, 'base64').toString('utf8')
    return JSON.parse(jsonText)
  } catch {
    return null
  }
}

function extractUtmFromTrafficSource(encodedValue) {
  const decoded = decodeTrafficSource(encodedValue)
  if (!decoded || typeof decoded !== 'object') return null

  const first = decoded?.first_session?.value || ''
  const current = decoded?.current_session?.value || ''
  const query = current || first
  if (!query) return null

  const params = new URLSearchParams(String(query))
  return {
    utm_source: params.get('utm_source') || null,
    utm_medium: params.get('utm_medium') || null,
    utm_campaign: params.get('utm_campaign') || null,
  }
}

async function fetchAllSegmentContacts(segmentId, accessToken) {
  const all = []
  let page = 1

  for (let i = 0; i < 200; i += 1) {
    const payload = await rdGet(`/platform/segmentations/${segmentId}/contacts`, accessToken, {
      page,
      page_size: 125,
    })

    const batch = Array.isArray(payload)
      ? payload
      : payload?.contacts || payload?.data || payload?.results || []

    if (!Array.isArray(batch) || batch.length === 0) break
    all.push(...batch)

    const nextPage =
      payload?.page?.next ||
      payload?.pagination?.next_page ||
      payload?.next_page ||
      payload?.meta?.next_page

    if (nextPage) {
      page = Number(nextPage)
    } else if (batch.length < 125) {
      break
    } else {
      page += 1
    }
  }

  return all
}

function toBudgetValue(value) {
  if (value === null || value === undefined || value === '') return null
  const raw = String(value).trim()
  const normalized = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

  if (
    normalized.includes('nao possuo') ||
    normalized.includes('não possuo') ||
    normalized.includes('sem liquidez') ||
    normalized.includes('nao tenho')
  ) {
    return 0
  }

  const rawNums = [...normalized.matchAll(/(\d[\d\.\,]*)/g)]
    .map((m) => Number(String(m[1]).replace(/\./g, '').replace(',', '.')))
    .filter((n) => Number.isFinite(n))

  const nums = rawNums.map((n) => {
    if (normalized.includes('mil') && n > 0 && n < 1000) return n * 1000
    return n
  })

  // Ex.: "Acima de R$ 25.000" / "25k+" / "mais de 25 mil"
  if (normalized.includes('acima') || normalized.includes('mais de') || normalized.includes('+')) {
    if (nums.length) return Math.max(...nums)
  }

  // Ex.: "25 mil a 50 mil" -> considera piso da faixa
  if (/\s+a\s+/.test(normalized) || normalized.includes(' ate ') || normalized.includes('até')) {
    if (nums.length >= 2) return Math.min(...nums)
  }

  const cleaned = raw.replace(/[^\d,.-]/g, '')
  if (!cleaned) return null
  const n = Number(cleaned.replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

function pickBudget(contact) {
  const directCandidates = [
    contact?.budget,
    contact?.orcamento,
    contact?.investment_budget,
    contact?.budget_value,
  ]
  for (const c of directCandidates) {
    const n = toBudgetValue(c)
    if (n !== null) return n
  }

  const fields = contact?.custom_fields || contact?.fields || []
  if (Array.isArray(fields)) {
    for (const f of fields) {
      const key = String(f?.name || f?.identifier || f?.key || '').toLowerCase()
      if (!key.includes('orc') && !key.includes('budget') && !key.includes('invest')) continue
      const n = toBudgetValue(f?.value)
      if (n !== null) return n
    }
  }

  // Em muitos contatos do RD os campos customizados vêm como chaves de topo: cf_*
  const entries = Object.entries(contact || {})
  for (const [key, value] of entries) {
    if (!/^cf_/i.test(key)) continue
    if (!/(orc|invest|valor|budget|liquidez)/i.test(key)) continue
    const n = toBudgetValue(value)
    if (n !== null) return n
  }

  return null
}

function normalizeLeadRow(clientId, contact, isMqlFromSegment) {
  const contactId =
    contact?.uuid ||
    contact?.id ||
    contact?.contact_uuid ||
    contact?.contact_id ||
    contact?.identifier ||
    null

  if (!contactId) return null

  const budgetValue = pickBudget(contact)
  const isMqlByBudget = budgetValue !== null ? budgetValue >= RD_MQL_BUDGET_THRESHOLD : false

  return {
    client_id: clientId,
    rd_contact_uuid: String(contactId),
    email: contact?.email || null,
    name: contact?.name || null,
    created_at_rd: contact?.created_at || contact?.createdAt || contact?.first_conversion_date || null,
    utm_source: contact?.utm_source || null,
    utm_medium: contact?.utm_medium || null,
    utm_campaign: contact?.utm_campaign || null,
    budget_value: budgetValue,
    is_mql_25k: Boolean(isMqlFromSegment || isMqlByBudget),
  }
}

async function main() {
  const clientId = INGEST_ONLY_CLIENT_ID
  if (!clientId) {
    throw new Error('Define INGEST_ONLY_CLIENT_ID with the target client UUID.')
  }

  console.log(`RD ingest: client ${clientId}`)

  const creds = await supabaseGet(
    `client_rd_credentials?select=client_id,access_token,refresh_token,is_active&client_id=eq.${clientId}&is_active=eq.true`
  )

  if (!creds.length) {
    throw new Error(`No active RD credentials found for client ${clientId}`)
  }

  const encryptedAccessToken = creds[0].access_token
  const encryptedRefreshToken = creds[0].refresh_token
  const refreshToken = decryptToken(encryptedRefreshToken)

  let accessToken
  try {
    accessToken = decryptToken(encryptedAccessToken)
    await rdGet('/platform/segmentations', accessToken, { page: 1, page_size: 1 })
  } catch {
    const refreshed = await refreshRdAccessToken(refreshToken)
    accessToken = refreshed.accessToken
    await supabasePatch(`client_rd_credentials?client_id=eq.${clientId}`, {
      access_token: encryptToken(refreshed.accessToken),
      refresh_token: encryptToken(refreshed.refreshToken),
      expires_in: refreshed.expiresIn,
      is_active: true,
    })
  }

  const segmentationsPayload = await rdGet('/platform/segmentations', accessToken, {
    page: 1,
    page_size: 125,
  })

  const segmentations = Array.isArray(segmentationsPayload)
    ? segmentationsPayload
    : segmentationsPayload?.segmentations ||
      segmentationsPayload?.data ||
      segmentationsPayload?.results ||
      []

  if (!Array.isArray(segmentations) || segmentations.length === 0) {
    throw new Error('No segmentations found on RD account.')
  }

  const leadsSeg = segmentations.find(
    (s) => normalizeSegmentName(s?.name) === normalizeSegmentName(RD_LEADS_SEGMENT_NAME)
  )
  const mqlSeg = segmentations.find(
    (s) => normalizeSegmentName(s?.name) === normalizeSegmentName(RD_MQL_SEGMENT_NAME)
  )

  if (!leadsSeg) {
    const names = segmentations.map((s) => s?.name).filter(Boolean)
    throw new Error(
      `Leads segment not found. Required: "${RD_LEADS_SEGMENT_NAME}". Available: ${names.join(' | ')}`
    )
  }

  if (mqlSeg) {
    console.log(`Using segments: leads="${leadsSeg.name}" mql="${mqlSeg.name}"`)
  } else {
    console.log(
      `Using segment: leads="${leadsSeg.name}" (mql segment "${RD_MQL_SEGMENT_NAME}" not found, falling back to budget threshold only)`
    )
  }

  const leadContacts = await fetchAllSegmentContacts(leadsSeg.id || leadsSeg.uuid, accessToken)
  const mqlContacts = mqlSeg
    ? await fetchAllSegmentContacts(mqlSeg.id || mqlSeg.uuid, accessToken)
    : []

  const mqlSet = new Set(
    mqlContacts
      .map((c) => c?.uuid || c?.id || c?.contact_uuid || c?.contact_id || c?.identifier)
      .filter(Boolean)
      .map(String)
  )

  async function fetchContactDetail(uuid) {
    return rdGet(`/platform/contacts/${uuid}`, accessToken)
  }

  async function fetchLatestConversionUtm(uuid) {
    const events = await rdGet(`/platform/contacts/${uuid}/events`, accessToken, {
      event_type: 'CONVERSION',
      page: 1,
      page_size: 10,
    })
    const arr = Array.isArray(events) ? events : events?.data || events?.events || []
    if (!Array.isArray(arr) || arr.length === 0) return null
    const latest = [...arr].sort((a, b) =>
      String(b?.event_timestamp || '').localeCompare(String(a?.event_timestamp || ''))
    )[0]
    const payload = latest?.payload || {}
    const fromTraffic = extractUtmFromTrafficSource(payload?.traffic_source)
    const conversionIdentifier =
      payload?.conversion_identifier || latest?.event_identifier || null
    if (fromTraffic) {
      return {
        ...fromTraffic,
        conversion_identifier: conversionIdentifier,
        conversion_at: latest?.event_timestamp || null,
      }
    }

    return {
      utm_source: payload?.utm_source || null,
      utm_medium: payload?.utm_medium || null,
      utm_campaign: payload?.utm_campaign || null,
      conversion_identifier: conversionIdentifier,
      conversion_at: latest?.event_timestamp || null,
    }
  }

  const detailsById = new Map()
  const utmById = new Map()
  for (let i = 0; i < leadContacts.length; i += 10) {
    const chunk = leadContacts.slice(i, i + 10)
    const detailedChunk = await Promise.all(
      chunk.map(async (c) => {
        const id = c?.uuid || c?.id || c?.contact_uuid || c?.contact_id || c?.identifier
        if (!id) return null
        try {
          const [detail, utm] = await Promise.all([
            fetchContactDetail(id),
            fetchLatestConversionUtm(id).catch(() => null),
          ])
          return [String(id), detail, utm]
        } catch {
          return [String(id), c, null]
        }
      })
    )
    for (const item of detailedChunk) {
      if (item) {
        detailsById.set(item[0], item[1])
        if (item[2]) utmById.set(item[0], item[2])
      }
    }
  }

  const rows = leadContacts
    .map((c) => {
      const id = String(c?.uuid || c?.id || c?.contact_uuid || c?.contact_id || c?.identifier || '')
      const detailed = detailsById.get(id) || c
      const row = normalizeLeadRow(clientId, detailed, mqlSet.has(id))
      if (!row) return null
      const utm = utmById.get(id)
      if (utm) {
        row.utm_source = utm.utm_source || row.utm_source
        row.utm_medium = utm.utm_medium || row.utm_medium
        row.utm_campaign =
          utm.utm_campaign ||
          row.utm_campaign ||
          utm.conversion_identifier ||
          row.utm_campaign
        row.created_at_rd = row.created_at_rd || utm.conversion_at || row.created_at_rd
      }
      return row
    })
    .filter(Boolean)

  if (!rows.length) {
    console.log('No leads found in leads segment. Nothing to upsert.')
    return
  }

  // Snapshot de 30 dias: evita acumular linhas antigas e inflar MQL no dashboard.
  await supabaseDelete(`rd_leads_30d?client_id=eq.${clientId}`)
  await supabaseUpsert('rd_leads_30d', rows, 'client_id,rd_contact_uuid')
  const patchedMissingDates = await backfillMissingCreatedAtWithImportedAt(clientId)

  const mqlCount = rows.filter((r) => r.is_mql_25k).length
  console.log(
    `Upsert complete: ${rows.length} leads, ${mqlCount} MQL (threshold ${RD_MQL_BUDGET_THRESHOLD}), backfilled_dates=${patchedMissingDates}`
  )
}

main().catch((err) => {
  console.error(err?.message || err)
  process.exit(1)
})
