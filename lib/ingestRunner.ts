import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'

const execFileAsync = promisify(execFile)

export async function runIngest(clientId?: string) {
  const scriptPath = path.join(process.cwd(), 'scripts', 'ingest_meta_to_supabase.mjs')

  await execFileAsync('node', [scriptPath], {
    env: {
      ...process.env,
      ...(clientId ? { INGEST_ONLY_CLIENT_ID: clientId } : {}),
    },
    maxBuffer: 10 * 1024 * 1024,
    timeout: 1000 * 60 * 15,
  })
}
