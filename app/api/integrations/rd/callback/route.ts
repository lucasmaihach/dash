import { NextRequest, NextResponse } from 'next/server'
import { encrypt } from '@/lib/crypto'
import { getSupabaseAdminClient } from '@/lib/supabase/admin'

type TokenResponse = {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

function getRequiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing environment variable: ${name}`)
  return value
}

async function exchangeCodeForTokens(code: string): Promise<TokenResponse> {
  const clientId = getRequiredEnv('RD_CLIENT_ID')
  const clientSecret = getRequiredEnv('RD_CLIENT_SECRET')

  const resp = await fetch('https://api.rd.services/auth/token?token_by=code', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
    }),
  })

  const data = (await resp.json()) as TokenResponse
  if (!resp.ok || !data.access_token || !data.refresh_token) {
    const reason = data.error_description || data.error || `status ${resp.status}`
    throw new Error(`RD token exchange failed: ${reason}`)
  }

  return data
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const code = (searchParams.get('code') || '').trim()
    const clientId = (searchParams.get('state') || '').trim()
    const error = (searchParams.get('error') || '').trim()
    const errorDescription = (searchParams.get('error_description') || '').trim()

    if (error) {
      return NextResponse.json(
        { error: 'rd_authorization_error', details: errorDescription || error },
        { status: 400 }
      )
    }

    if (!code) {
      return NextResponse.json({ error: 'missing_code' }, { status: 400 })
    }

    if (!clientId) {
      return NextResponse.json({ error: 'missing_client_id_in_state' }, { status: 400 })
    }

    const tokens = await exchangeCodeForTokens(code)

    const supabase = getSupabaseAdminClient()
    const { error: upsertError } = await supabase.from('client_rd_credentials').upsert(
      {
        client_id: clientId,
        access_token: encrypt(tokens.access_token!),
        refresh_token: encrypt(tokens.refresh_token!),
        expires_in: tokens.expires_in || null,
        is_active: true,
      },
      { onConflict: 'client_id' }
    )

    if (upsertError) {
      return NextResponse.json(
        {
          error: 'token_obtained_but_not_saved',
          details: upsertError.message,
          hint: 'Create table public.client_rd_credentials before retrying callback.',
        },
        { status: 500 }
      )
    }

    return NextResponse.json({
      ok: true,
      message: 'RD conectado com sucesso e tokens salvos.',
      client_id: clientId,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: 'internal_error', message }, { status: 500 })
  }
}

