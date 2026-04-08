import { NextRequest, NextResponse } from 'next/server'

function getRequiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing environment variable: ${name}`)
  return value
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const clientId = (searchParams.get('clientId') || '').trim()

    if (!clientId) {
      return NextResponse.json({ error: 'missing_client_id' }, { status: 400 })
    }

    const rdClientId = getRequiredEnv('RD_CLIENT_ID')
    const redirectUri = getRequiredEnv('RD_REDIRECT_URI')

    const authUrl = new URL('https://api.rd.services/auth/dialog')
    authUrl.searchParams.set('client_id', rdClientId)
    authUrl.searchParams.set('redirect_uri', redirectUri)
    authUrl.searchParams.set('state', clientId)

    return NextResponse.redirect(authUrl.toString(), { status: 302 })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: 'internal_error', message }, { status: 500 })
  }
}

