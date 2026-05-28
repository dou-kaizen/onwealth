/**
 * Apply role-level Postgres timeouts via `pg` driver.
 *
 * Replaces a previous `psql -f` invocation so the script runs on any machine
 * with Node + pnpm install (no system `psql` / libpq client required).
 *
 * Reads DATABASE_URL from packages/database/.env (resolved relative to this
 * file, not CWD — mirrors drizzle.config.ts behavior).
 *
 * SQL source: sql/00-init-role-timeouts.sql (executed verbatim, single round-trip).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { config } from 'dotenv'
import { Client } from 'pg'

const here = path.dirname(fileURLToPath(import.meta.url))
const pkgRoot = path.resolve(here, '..')

config({ path: path.join(pkgRoot, '.env') })

const dbUrl = process.env.DATABASE_URL
if (!dbUrl) {
  console.error(
    'DATABASE_URL is required. Copy packages/database/.env.example to packages/database/.env and set it.',
  )
  process.exit(1)
}

const sqlPath = path.join(pkgRoot, 'sql', '00-init-role-timeouts.sql')
const sql = readFileSync(sqlPath, 'utf8')

const client = new Client({ connectionString: dbUrl })

try {
  await client.connect()
  await client.query(sql)
  const role = (await client.query('SELECT current_user')).rows[0]?.current_user
  // biome-ignore lint/suspicious/noConsole: CLI script — stdout is the user-facing channel
  console.log(`✓ Role timeouts applied to "${role}" (statement=30s, lock=10s, idle_in_tx=60s)`)
} catch (err) {
  console.error('✗ init-roles failed:', err)
  process.exit(1)
} finally {
  await client.end().catch((endErr) => {
    console.warn(
      'client.end() failed (ignored):',
      endErr instanceof Error ? endErr.message : endErr,
    )
  })
}
