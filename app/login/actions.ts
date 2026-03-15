'use server'

import { redirect } from 'next/navigation'
import { getSupabaseServerClient } from '@/lib/supabase/server'

export async function loginAction(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim()
  const password = String(formData.get('password') ?? '')

  if (!email || !password) {
    redirect('/login?error=Preencha+email+e+senha')
  }

  const supabase = await getSupabaseServerClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    redirect('/login?error=Credenciais+invalidas')
  }

  redirect('/dashboard')
}
