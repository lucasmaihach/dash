'use server'

import { redirect } from 'next/navigation'
import { revalidateTag } from 'next/cache'
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

function toShortReason(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  return encodeURIComponent(raw.slice(0, 180))
}

function formatDateOnly(date: Date) {
  return date.toISOString().slice(0, 10)
}

function subtractDays(date: Date, days: number) {
  const copy = new Date(date)
  copy.setDate(copy.getDate() - days)
  return copy
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

  if (profileError) {
    redirect(buildDashboardRedirect(returnTo, 'sync=failed'))
  }

  const isAdminView = profile.role === 'admin' && !!asClientId
  const effectiveClientId = isAdminView ? asClientId : profile.client_id

  if (!effectiveClientId) {
    redirect(buildDashboardRedirect(returnTo, 'sync=failed'))
  }

  let ingestError: unknown = null
  try {
    const admin = getSupabaseAdminClient()
    const { data: clientMeta } = await admin
      .from('clients')
      .select('last_ingest_until')
      .eq('id', effectiveClientId)
      .maybeSingle()

    const untilDate = new Date()
    const fallbackSinceDate = subtractDays(untilDate, 90)
    const lastUntil = clientMeta?.last_ingest_until ? new Date(clientMeta.last_ingest_until) : null
    const sinceDate = lastUntil ? subtractDays(lastUntil, 1) : fallbackSinceDate

    const since = formatDateOnly(sinceDate)
    const until = formatDateOnly(untilDate)

    await runIngest(effectiveClientId, { mode: 'refresh', since, until })

    await admin
      .from('clients')
      .update({
        last_ingest_since: since,
        last_ingest_until: until,
        last_ingest_at: new Date().toISOString(),
      })
      .eq('id', effectiveClientId)

    // Garante que a UI reflita os dados recém ingeridos mesmo se a revalidação
    // externa do script falhar (ex.: APP_BASE_URL/REVALIDATE_SECRET).
    revalidateTag(`metrics:${effectiveClientId}`)
  } catch (err) {
    console.error('[refreshClientDataAction] ingest:', err)
    ingestError = err
  }

  redirect(ingestError
    ? buildDashboardRedirect(returnTo, `sync=failed&sync_reason=${toShortReason(ingestError)}`)
    : buildDashboardRedirect(returnTo, 'sync=done')
  )
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
