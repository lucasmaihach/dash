import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promisify } from 'node:util'
import path from 'node:path'

const execFileAsync = promisify(execFile)

export type IngestMode = 'default' | 'initial' | 'refresh'

type IngestOptions = {
  mode?: IngestMode
}

function formatDateOnly(date: Date) {
  return date.toISOString().slice(0, 10)
}

function buildIngestWindow(mode: IngestMode) {
  const until = new Date()

  if (mode === 'initial') {
    const since = new Date(until)
    since.setMonth(since.getMonth() - 12)
    return {
      since: formatDateOnly(since),
      until: formatDateOnly(until),
    }
  }

  if (mode === 'refresh') {
    const since = new Date(until)
    since.setDate(since.getDate() - 6)
    return {
      since: formatDateOnly(since),
      until: formatDateOnly(until),
    }
  }

  return null
}

async function runScript(
  scriptName: string,
  clientId?: string,
  options: IngestOptions = {},
  extraEnv: Record<string, string> = {}
) {
  const cwd = process.cwd()
  const scriptPath = path.join(cwd, 'scripts', scriptName)
  const envFile = path.join(cwd, '.env.local')
  const args = existsSync(envFile) ? ['--env-file=.env.local', scriptPath] : [scriptPath]
  const mode = options.mode ?? 'default'
  const window = buildIngestWindow(mode)

  await execFileAsync('node', args, {
    cwd,
    env: {
      ...process.env,
      ...(clientId ? { INGEST_ONLY_CLIENT_ID: clientId } : {}),
      ...(window
        ? {
            INGEST_DATE_SINCE: window.since,
            INGEST_DATE_UNTIL: window.until,
            INGEST_MODE: mode,
          }
        : {}),
      ...extraEnv,
    },
    maxBuffer: 10 * 1024 * 1024,
    timeout: 1000 * 60 * 15,
  })
}

export async function runIngest(clientId?: string, options: IngestOptions = {}) {
  const errors: string[] = []

  // Roda Meta
  try {
    await runScript('ingest_meta_to_supabase.mjs', clientId, options)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    errors.push(`Meta: ${message}`)
  }

  // Roda Google (falha silenciosa se não houver credenciais configuradas)
  try {
    await runScript('ingest_google_to_supabase.mjs', clientId, options)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // Ignora erros de "sem clientes" — cliente pode não ter Google configurado
    if (!message.includes('no active Google') && !message.includes('no clients')) {
      errors.push(`Google: ${message}`)
    }
  }

  // Roda RD para cliente específico (não roda em "all_clients")
  // Segmentações padrão do projeto:
  // - LEADS_30D_IOX
  // - G77 - Qualificado 25k
  if (clientId) {
    try {
      await runScript(
        'ingest_rd_to_supabase.mjs',
        clientId,
        options,
        {
          RD_LEADS_SEGMENT_NAME: process.env.RD_LEADS_SEGMENT_NAME || 'LEADS_30D_IOX',
          RD_MQL_SEGMENT_NAME: process.env.RD_MQL_SEGMENT_NAME || 'G77 - Qualificado 25k',
        }
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // Cliente pode não ter RD conectado ainda.
      if (!message.includes('No active RD credentials found')) {
        errors.push(`RD: ${message}`)
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`runIngest failed (${clientId || 'all_clients'}): ${errors.join(' | ')}`)
  }
}
