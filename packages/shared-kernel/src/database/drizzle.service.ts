import type { OnModuleDestroy } from '@nestjs/common'
import { Injectable } from '@nestjs/common'
import type { Pool } from 'pg'

import type { DrizzleDb } from './db.port.js'

/**
 * DrizzleService holds the Drizzle db instance and the underlying pg Pool.
 *
 * Implements OnModuleDestroy so that when NestJS receives SIGTERM/SIGINT
 * (enabled via app.enableShutdownHooks() in main.ts), the pool is drained
 * gracefully — waiting for all active clients before closing.
 *
 * Injected into consumers via DB_TOKEN (see db.module.ts).
 */
@Injectable()
export class DrizzleService implements OnModuleDestroy {
  readonly db: DrizzleDb
  private readonly pool: Pool

  constructor(db: DrizzleDb, pool: Pool) {
    this.db = db
    this.pool = pool
  }

  /** Called by NestJS on SIGTERM/SIGINT. Drains all active pool connections. */
  async onModuleDestroy(): Promise<void> {
    await this.pool.end()
  }
}
