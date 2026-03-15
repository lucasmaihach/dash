import { revalidateTag } from 'next/cache'
import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/revalidate
 *
 * Invalida o cache de métricas de um cliente específico.
 * Chamado pelo script de ingestão após o upsert para garantir
 * que o dashboard reflita os dados mais recentes imediatamente.
 *
 * Body JSON: { "clientId": "<uuid>" }
 * Header:    Authorization: Bearer <REVALIDATE_SECRET>
 */
export async function POST(req: NextRequest) {
  const secret = process.env.REVALIDATE_SECRET
  const authHeader = req.headers.get('authorization') ?? ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''

  if (!secret || token !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let clientId: string | undefined

  try {
    const body = await req.json()
    clientId = typeof body?.clientId === 'string' ? body.clientId.trim() : undefined
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!clientId) {
    return NextResponse.json({ error: 'clientId is required' }, { status: 400 })
  }

  revalidateTag(`metrics:${clientId}`)

  return NextResponse.json({ revalidated: true, clientId })
}
