import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { config } from 'dotenv'
import { defineConfig } from 'drizzle-kit'

// Resolve .env relative to this file, not CWD — prevents broken CI migration paths
config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '.env') })

const dbUrl = process.env.DATABASE_URL
if (!dbUrl) {
  throw new Error(
    'DATABASE_URL is required for drizzle-kit. Copy packages/database/.env.example to packages/database/.env and set it.',
  )
}

export default defineConfig({
  schema: ['./src/schemas'],
  out: './drizzle',
  dialect: 'postgresql',
  // strict: true prevents accidental drop-table migrations when schema is empty (export {} guard)
  strict: true,
  dbCredentials: { url: dbUrl },
})
