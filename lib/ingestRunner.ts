import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promisify } from 'node:util'
import path from 'node:path'

const execFileAsync = promisify(execFile)

export async function runIngest(clientId?: string) {
  const cwd = process.cwd()
  const scriptPath = path.join(cwd, 'scripts', 'ingest_meta_to_supabase.mjs')
  const envFile = path.join(cwd, '.env.local')
  const args = existsSync(envFile) ? ['--env-file=.env.local', scriptPath] : [scriptPath]

  try {
    await execFileAsync('node', args, {
      cwd,
      env: {
        ...process.env,
        ...(clientId ? { INGEST_ONLY_CLIENT_ID: clientId } : {}),
      },
      maxBuffer: 10 * 1024 * 1024,
      timeout: 1000 * 60 * 15,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`runIngest failed (${clientId || 'all_clients'}): ${message}`)
  }
}
