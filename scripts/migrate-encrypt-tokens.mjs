/**
 * scripts/migrate-encrypt-tokens.mjs
 *
 * Migração única: lê todos os tokens em texto puro de client_meta_credentials
 * e os substitui pela versão criptografada.
 *
 * Execute UMA VEZ após adicionar ENCRYPT_KEY ao .env.local:
 *   node scripts/migrate-encrypt-tokens.mjs
 *
 * O script é idempotente: tokens que já estão no formato iv:authTag:ciphertext
 * são ignorados automaticamente.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ENCRYPT_KEY = process.env.ENCRYPT_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

if (!ENCRYPT_KEY || ENCRYPT_KEY.length < 16) {
  console.error('Missing or invalid ENCRYPT_KEY (minimum 16 characters)')
  process.exit(1)
}

// ---------- crypto helpers ----------
function getDerivedKey() {
  return scryptSync(ENCRYPT_KEY, 'meta-dashboard-salt', 32)
}

function isAlreadyEncrypted(value) {
  const parts = value.split(':')
  return parts.length === 3 && parts.every((p) => /^[0-9a-f]+$/i.test(p))
}

function encrypt(plaintext) {
  const key = getDerivedKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return [iv.toString('hex'), authTag.toString('hex'), encrypted.toString('hex')].join(':')
}
// ------------------------------------

async function supabaseRequest(path, options = {}) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  })
  const text = await resp.text()
  if (!resp.ok) throw new Error(`Supabase request failed (${resp.status}): ${text}`)
  return text ? JSON.parse(text) : null
}

async function main() {
  console.log('Fetching all credentials...')
  const credentials = await supabaseRequest('client_meta_credentials?select=client_id,access_token')

  let skipped = 0
  let migrated = 0
  let errors = 0

  for (const cred of credentials) {
    if (isAlreadyEncrypted(cred.access_token)) {
      console.log(`client ${cred.client_id}: already encrypted, skipping`)
      skipped++
      continue
    }

    try {
      const encryptedToken = encrypt(cred.access_token)
      await supabaseRequest(`client_meta_credentials?client_id=eq.${cred.client_id}`, {
        method: 'PATCH',
        body: JSON.stringify({ access_token: encryptedToken })
      })
      console.log(`client ${cred.client_id}: migrated successfully`)
      migrated++
    } catch (err) {
      console.error(`client ${cred.client_id}: FAILED —`, err.message)
      errors++
    }
  }

  console.log(`\nDone. migrated=${migrated} skipped=${skipped} errors=${errors}`)
  if (errors > 0) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
