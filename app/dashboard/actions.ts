'use server'

import { redirect } from 'next/navigation'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { getSupabaseAdminClient } from '@/lib/supabase/admin'
import { runIngest } from '@/lib/ingestRunner'

export async function deleteProductReportAction(formData: FormData) {
  const reportId = String(formData.get('report_id') || '').trim()
  const asClientId = String(formData.get('as') || '').trim()

  if (!reportId) redirect('/dashboard')

  const supabase = await getSupabaseServerClient()
  const {
    data: { user }
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('client_id, role')
    .eq('id', user.id)
    .single()

  if (!profile?.client_id) redirect('/dashboard')

  const isAdminView = profile.role === 'admin' && !!asClientId
  const effectiveClientId = isAdminView ? asClientId : profile.client_id
  const admin = getSupabaseAdminClient()

  // Verifica ownership antes de deletar: o relatório deve pertencer ao client_id efetivo.
  // Usamos admin client para garantir que a deleção funciona independente de políticas RLS de DELETE.
  const { data: report } = await admin
    .from('product_reports')
    .select('id')
    .eq('id', reportId)
    .eq('client_id', effectiveClientId)
    .single()

  // Se não encontrou, o relatório não existe ou não pertence a este cliente — ignora silenciosamente
  if (report) {
    await admin.from('product_reports').delete().eq('id', reportId)
  }

  // Redireciona para o dashboard sem nenhum relatório selecionado
  const redirectUrl = asClientId ? `/dashboard?as=${asClientId}` : '/dashboard'
  redirect(redirectUrl)
}

function buildDashboardRedirect(base: string, patch: string) {
  const safeBase = base.startsWith('/dashboard') ? base : '/dashboard'
  return `${safeBase}${safeBase.includes('?') ? '&' : '?'}${patch}`
}

export async function refreshClientDataAction(formData: FormData) {
  const asClientId = String(formData.get('as') || '').trim()
  const returnTo = String(formData.get('return_to') || '/dashboard').trim()

  const supabase = await getSupabaseServerClient()
  const {
    data: { user }
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('client_id, role')
    .eq('id', user.id)
    .single()

  if (profileError || !profile?.client_id) {
    redirect(buildDashboardRedirect(returnTo, 'sync=failed'))
  }

  const isAdminView = profile.role === 'admin' && !!asClientId
  const effectiveClientId = isAdminView ? asClientId : profile.client_id

  try {
    await runIngest(effectiveClientId)
    redirect(buildDashboardRedirect(returnTo, 'sync=done'))
  } catch (err) {
    console.error('[refreshClientDataAction] ingest:', err)
    redirect(buildDashboardRedirect(returnTo, 'sync=failed'))
  }
}

export async function createProductReportAction(formData: FormData) {
  const name = String(formData.get('report_name') || '').trim()
  const tagFilter = String(formData.get('report_tag') || '').trim()
  const campaignFilter = String(formData.get('report_campaign') || '').trim()
  const asClientId = String(formData.get('as') || '').trim()

  if (!name || !tagFilter) {
    const base = asClientId ? `/dashboard?as=${asClientId}&` : '/dashboard?'
    redirect(`${base}error=missing_report_fields`)
  }

  const supabase = await getSupabaseServerClient()
  const {
    data: { user }
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('client_id, role')
    .eq('id', user.id)
    .single()

  if (profileError || !profile?.client_id) {
    redirect('/dashboard?error=missing_profile')
  }

  // Se admin está visualizando outro cliente, usa o client_id do cliente visualizado
  const isAdminView = profile.role === 'admin' && !!asClientId
  const effectiveClientId = isAdminView ? asClientId : profile.client_id
  const db = isAdminView ? getSupabaseAdminClient() : supabase

  const { data, error } = await db
    .from('product_reports')
    .insert({
      client_id: effectiveClientId,
      name,
      tag_filter: tagFilter,
      campaign_filter: campaignFilter || null,
      created_by: user.id
    })
    .select('id')
    .single()

  if (error) {
    console.error('[createProductReportAction] Supabase error:', error.code, error.message, error.details, error.hint)
    if (error.code === '42P01') {
      redirect('/dashboard?error=missing_product_reports_table')
    }
    const base = asClientId ? `/dashboard?as=${asClientId}&` : '/dashboard?'
    redirect(`${base}error=create_report_failed&code=${error.code}`)
  }

  // Preserva o ?as= no redirect
  const redirectUrl = asClientId
    ? `/dashboard?as=${asClientId}&report=${data.id}`
    : `/dashboard?report=${data.id}`

  redirect(redirectUrl)
}
