import type { OnModuleDestroy } from '@nestjs/common'
import { Injectable } from '@nestjs/common'
import type { Pool } from 'pg'

import type { DrizzleDb } from './db.port.js'

/**
 * Lifecycle owner for the Drizzle `db` and its underlying pg `Pool`.
 *
 * Implements {@link OnModuleDestroy} so that when NestJS receives
 * `SIGTERM`/`SIGINT` (enabled via `app.enableShutdownHooks()` in `main.ts`),
 * `pool.end()` drains active clients gracefully before the process exits.
 *
 * Consumers receive the typed db handle via `@Inject(DB_TOKEN)`; the pool
 * itself is private — repositories should never touch it directly.
 *
 * @see DrizzleModule for the DI wiring.
 */
@Injectable()
export class DrizzleService implements OnModuleDestroy {
  readonly db: DrizzleDb
  private readonly pool: Pool

  constructor(db: DrizzleDb, pool: Pool) {
    this.db = db
    this.pool = pool
  }

  /**
   * Drain all pool connections on shutdown.
   *
   * Awaits in-flight queries before resolving. Triggered by NestJS shutdown
   * hooks (`SIGTERM` / `SIGINT`).
   */
  async onModuleDestroy(): Promise<void> {
    await this.pool.end()
  }
}
