import { redirect } from 'next/navigation'
import { getSupabaseServerClient } from '@/lib/supabase/server'

const AUTH_TIMEOUT_MS = 2500

async function getUserWithTimeout(getUserFn: () => Promise<{ data: { user: unknown } }>) {
  const timeoutPromise = new Promise<{ data: { user: null } }>((resolve) => {
    setTimeout(() => resolve({ data: { user: null } }), AUTH_TIMEOUT_MS)
  })

  try {
    return await Promise.race([getUserFn(), timeoutPromise])
  } catch {
    return { data: { user: null } }
  }
}

export default async function HomePage() {
  const supabase = await getSupabaseServerClient()
  const { data } = await getUserWithTimeout(() => supabase.auth.getUser())
  const user = data.user

  if (user) {
    redirect('/dashboard')
  }

  redirect('/login')
}
