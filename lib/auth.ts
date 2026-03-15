import { redirect } from 'next/navigation'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { getSupabaseAdminClient } from '@/lib/supabase/admin'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Resolve o clientId efetivo para o request atual, aplicando todas as
 * validações de segurança antes de retornar qualquer dado.
 *
 * Regras:
 * - Usuário não autenticado → redirect /login
 * - Usuário sem profile/client_id → retorna erro descritivo
 * - Usuário não-admin tentando ?as= → ignora silenciosamente (usa próprio client_id)
 * - Admin com ?as= inválido (não-UUID) → redirect /admin
 * - Admin com ?as= de cliente inexistente ou inativo → redirect /admin
 * - Admin com ?as= válido → retorna o client_id impersonado
 */
export async function resolveEffectiveClient(asParam: string | undefined): Promise<
  | { ok: true; effectiveClientId: string; isAdminView: boolean; profile: { client_id: string; full_name: string | null; role: string } }
  | { ok: false; reason: 'no_profile' }
> {
  const supabase = await getSupabaseServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('client_id, full_name, role')
    .eq('id', user.id)
    .single()

  if (profileError || !profile?.client_id) {
    return { ok: false, reason: 'no_profile' }
  }

  // Usuário não-admin: ignora ?as= completamente
  if (profile.role !== 'admin' || !asParam) {
    return {
      ok: true,
      effectiveClientId: profile.client_id,
      isAdminView: false,
      profile,
    }
  }

  // Admin com ?as=: valida formato UUID antes de qualquer query
  if (!UUID_REGEX.test(asParam)) {
    redirect('/admin?error=invalid_client_id')
  }

  // Valida que o cliente existe e está ativo
  const { data: targetClient, error: clientError } = await getSupabaseAdminClient()
    .from('clients')
    .select('id, status')
    .eq('id', asParam)
    .single()

  if (clientError || !targetClient) {
    redirect('/admin?error=client_not_found')
  }

  if (targetClient.status !== 'active') {
    redirect('/admin?error=client_inactive')
  }

  return {
    ok: true,
    effectiveClientId: asParam,
    isAdminView: true,
    profile,
  }
}
