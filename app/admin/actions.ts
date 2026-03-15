'use server'

import { redirect } from 'next/navigation'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { getSupabaseAdminClient } from '@/lib/supabase/admin'
import { encrypt } from '@/lib/crypto'

async function requireAdmin() {
  const supabase = await getSupabaseServerClient()
  const {
    data: { user }
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin') redirect('/dashboard')

  return user
}

export async function createClientAction(formData: FormData) {
  await requireAdmin()

  const name = String(formData.get('name') || '').trim()
  const email = String(formData.get('email') || '').trim()
  const password = String(formData.get('password') || '').trim()
  const fullName = String(formData.get('full_name') || '').trim()
  const accessToken = String(formData.get('access_token') || '').trim()
  const adAccountId = String(formData.get('ad_account_id') || '').trim()
  const accountLabel = String(formData.get('account_label') || 'Conta Principal').trim()

  if (!name || !email || !password || !accessToken || !adAccountId) {
    redirect('/admin?error=missing_fields')
  }

  const admin = getSupabaseAdminClient()

  // 1. Criar cliente
  const { data: client, error: clientError } = await admin
    .from('clients')
    .insert({ name })
    .select('id')
    .single()

  if (clientError) {
    console.error('[createClientAction] client:', clientError)
    redirect('/admin?error=create_client_failed')
  }

  // 2. Criar usuário no Auth
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName || name }
  })

  if (authError) {
    console.error('[createClientAction] auth:', authError)
    await admin.from('clients').delete().eq('id', client.id)
    redirect('/admin?error=create_user_failed')
  }

  // 3. Criar perfil
  const { error: profileError } = await admin.from('profiles').insert({
    id: authData.user.id,
    client_id: client.id,
    full_name: fullName || name,
    role: 'viewer'
  })

  if (profileError) {
    console.error('[createClientAction] profile:', profileError)
    redirect('/admin?error=create_profile_failed')
  }

  // 4. Credenciais Meta (token criptografado em repouso)
  const { error: credError } = await admin.from('client_meta_credentials').insert({
    client_id: client.id,
    access_token: encrypt(accessToken),
    is_active: true
  })

  if (credError) {
    console.error('[createClientAction] credentials:', credError)
    redirect('/admin?error=create_credentials_failed')
  }

  // 5. Conta de anúncios
  const { error: accountError } = await admin.from('client_ad_accounts').insert({
    client_id: client.id,
    ad_account_id: adAccountId,
    label: accountLabel,
    is_active: true
  })

  if (accountError) {
    console.error('[createClientAction] ad_account:', accountError)
    redirect('/admin?error=create_account_failed')
  }

  redirect('/admin?success=client_created')
}

export async function setClientStatusAction(formData: FormData) {
  await requireAdmin()

  const clientId = String(formData.get('client_id') || '')
  const status = String(formData.get('status') || '')

  if (!clientId || !['active', 'inactive'].includes(status)) redirect('/admin')

  const admin = getSupabaseAdminClient()
  await admin.from('clients').update({ status }).eq('id', clientId)

  redirect(`/admin?success=${status === 'active' ? 'client_reactivated' : 'client_deactivated'}`)
}
