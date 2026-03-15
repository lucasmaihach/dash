import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

const AUTH_TIMEOUT_MS = 2500

async function getUserWithTimeout(
  getUserFn: () => Promise<{ data: { user: unknown } }>,
  timeoutMs: number
) {
  const timeoutPromise = new Promise<{ data: { user: null } }>((resolve) => {
    setTimeout(() => resolve({ data: { user: null } }), timeoutMs)
  })

  try {
    return await Promise.race([getUserFn(), timeoutPromise])
  } catch {
    return { data: { user: null } }
  }
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request })
  const isAuthPage = request.nextUrl.pathname.startsWith('/login')
  const isDashboard = request.nextUrl.pathname.startsWith('/dashboard')
  const isAdmin = request.nextUrl.pathname.startsWith('/admin')

  // Never block /login with auth lookup to avoid hanging login page.
  if (isAuthPage) {
    return response
  }

  // If env is missing, do not block navigation in middleware.
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return response
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options?: Record<string, unknown> }>) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value)
            response.cookies.set(name, value, options)
          })
        }
      }
    }
  )

  const { data } = await getUserWithTimeout(() => supabase.auth.getUser(), AUTH_TIMEOUT_MS)
  const user = data.user

  if (!user && (isDashboard || isAdmin)) {
    const url = new URL('/login', request.url)
    return NextResponse.redirect(url)
  }

  return response
}

export const config = {
  matcher: ['/dashboard/:path*', '/admin/:path*', '/admin', '/login', '/']
}
