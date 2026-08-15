#!/usr/bin/env node
/**
 * Re-apply the SDK-server resume patch to the sibling deepseek-harness
 * checkout after it has been updated.
 *
 * Without this patch, the SDK JSON-RPC server cannot resume a persisted
 * session across a process restart: `createSession` calls `agents.create`
 * without seeding the stored history, so the persistence coordinator rejects
 * the id as a collision. This is the SDK-path equivalent of the web host's
 * `agents.resume()` / `Session.fromRestore(seedSource: 'persistence')`.
 *
 * Idempotent: skips when already applied, then rebuilds the host libs so the
 * runtime picks it up. Fail loudly on any anchor mismatch (upstream drift)
 * rather than silently mis-applying.
 *
 * Env overrides:
 *   DSH_REPO        - path to the deepseek-harness checkout (auto-detected sibling)
 *   DSH_SERVER_FILE - target server.ts path (testing)
 *   DSH_PATCH_DRY=1 - apply to a temp copy and print, skip write + rebuild
 */
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join, dirname, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { execSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = process.env.DSH_REPO ?? resolve(join(HERE, '..', '..', 'deepseek-harness'))
const SERVER = process.env.DSH_SERVER_FILE ?? join(REPO, 'packages/sdk/server/src/server.ts')
const DRY = process.env.DSH_PATCH_DRY === '1'

const MARKER = 'Resume a session a previous runtime process persisted'

const IMPORT_OLD = "import { SessionId } from '@deepseek-ai/dsh-session'"
const IMPORT_NEW =
  "import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'\n"
  + "import type { SessionInspection } from '@deepseek-ai/dsh-session-persistence'"

const BODY_OLD = `  private async createSession(sessionId: string): Promise<SessionRecord> {
    // No preset composition: this server's compositions keep the model-facing`
const BODY_NEW = `  private async createSession(sessionId: string): Promise<SessionRecord> {
    // Resume a session a previous runtime process persisted: seed the new live
    // session with the stored events so the persistence coordinator adopts the
    // log instead of raising an id collision.
    let seed: readonly SessionEvent[] | undefined
    const persistence = this.ctx.get('sessionPersistence') as { load(id: SessionId): Promise<SessionInspection> } | undefined
    if (persistence !== undefined) {
      try {
        seed = (await persistence.load(SessionId(sessionId))).events
      } catch {
        seed = undefined
      }
    }
    // No preset composition: this server's compositions keep the model-facing`

const CALL_OLD = `      meta: { cwd: this.cwd },
      agentOptions: {`
const CALL_NEW = `      meta: { cwd: this.cwd },
      ...(seed === undefined ? {} : { seed }),
      agentOptions: {`

if (!existsSync(SERVER)) {
  console.error(`cannot find ${SERVER}`)
  process.exit(1)
}
let src = readFileSync(SERVER, 'utf8')
if (src.includes(MARKER)) {
  console.log('resume patch already applied — nothing to do')
  process.exit(0)
}

const replacements = [
  [IMPORT_OLD, IMPORT_NEW],
  [BODY_OLD, BODY_NEW],
  [CALL_OLD, CALL_NEW],
]
for (const [old, next] of replacements) {
  if (!src.includes(old)) {
    console.error(`patch anchor not found (upstream drift?):\n${old}`)
    process.exit(1)
  }
  src = src.split(old).join(next)
}

if (DRY) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-patch-'))
  const out = join(dir, basename(SERVER))
  writeFileSync(out, src)
  console.log(`[dry-run] would patch ${SERVER}`)
  console.log(`[dry-run] result written to ${out}`)
  rmSync(dir, { recursive: true, force: true })
  process.exit(0)
}

writeFileSync(SERVER, src)
console.log(`resume patch applied to ${SERVER}`)
console.log('rebuilding host libs (npm run build:lib:host)…')
execSync('npm run build:lib:host', { cwd: REPO, stdio: 'inherit' })
console.log('done')
