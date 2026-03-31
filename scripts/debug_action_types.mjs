import { scryptSync, createDecipheriv } from 'crypto'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

function getDerivedKey() { return scryptSync(process.env.ENCRYPT_KEY, 'meta-dashboard-salt', 32) }
function decryptToken(ct) {
  const [ivHex, authTagHex, dataHex] = ct.split(':')
  const d = createDecipheriv('aes-256-gcm', getDerivedKey(), Buffer.from(ivHex, 'hex'))
  d.setAuthTag(Buffer.from(authTagHex, 'hex'))
  return d.update(Buffer.from(dataHex, 'hex')).toString('utf8') + d.final('utf8')
}

async function supabaseGet(path) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` }
  })
  return resp.json()
}

const creds = await supabaseGet('client_meta_credentials?select=client_id,access_token&is_active=eq.true')
const accs = await supabaseGet('client_ad_accounts?select=client_id,ad_account_id&is_active=eq.true')

for (const cred of creds) {
  const token = decryptToken(cred.access_token)
  const clientAccs = accs.filter(a => a.client_id === cred.client_id)
  for (const acc of clientAccs) {
    const accountId = acc.ad_account_id
    console.log('\n=== Account:', accountId, '===')
    const url = `https://graph.facebook.com/v21.0/act_${accountId}/insights?fields=campaign_name,actions&date_preset=last_30d&level=campaign&limit=3&access_token=${token}`
    const data = await fetch(url).then(r => r.json())
    if (data.error) { console.log('Erro:', data.error.message); continue }
    const allTypes = new Set()
    for (const row of (data.data || [])) {
      for (const a of (row.actions || [])) allTypes.add(a.action_type)
    }
    console.log('Action types:', [...allTypes].sort().join(', '))
    // Mostra follow/like especificamente
    for (const row of (data.data || [])) {
      const followActions = (row.actions || []).filter(a =>
        a.action_type.includes('follow') || a.action_type.includes('like') || a.action_type.includes('fan')
      )
      if (followActions.length > 0) {
        console.log('  Campanha:', row.campaign_name?.slice(0,40))
        followActions.forEach(a => console.log(`    ${a.action_type}: ${a.value}`))
      }
    }
  }
}
