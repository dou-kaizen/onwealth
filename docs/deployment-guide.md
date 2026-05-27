# Deployment Guide

Operational playbook for deploying the onwealth API and running database migrations.

This guide covers three migration-runner patterns. **Pick exactly one per environment and never run two of them concurrently** (concurrent runners can deadlock on `drizzle_migrations` or apply the same migration twice).

---

## Migration Strategy: Pick One

All three patterns implement the 12-factor "release phase" principle: migrations run **once per release, before the app boots**, in a transactional, idempotent way.

| Pattern | When to use | Pros | Cons |
|---------|-------------|------|------|
| **A. CI pre-deploy step** | Single-region deploys, GitHub Actions / GitLab CI workflows you already trust. | Simplest. Migrations run in a sandboxed CI runner with full toolchain. Easy rollback (re-run pipeline). | CI runner needs network access to prod DB (usually behind VPN / IP allowlist). Adds CI build minutes. |
| **B. Kubernetes init container** | Kubernetes deployments where you want migrations co-located with the pod lifecycle. | No extra CI permissions. Migrations rerun on every pod restart (idempotent — Drizzle skips applied migrations). Same image, no version-skew. | Runs on every pod boot — N replicas means N idle invocations (cheap but noisy). One failing init container blocks rollout. |
| **C. Kubernetes Job / Helm hook** | Multi-region / blue-green deploys, or when you need a single migration run gated before traffic shifts. | Explicit one-shot — runs exactly once per release via Helm `pre-install`/`pre-upgrade` hook or ArgoCD `PreSync`. Clean separation of release-phase work from steady-state pods. | More YAML. Job failure handling needs care (`backoffLimit`, `ttlSecondsAfterFinished`). Requires the migration image in the cluster registry. |

### Anti-pattern: app-boot migrations

**Do not** call `drizzle-kit migrate` (or any migration runner) from `bootstrap()` / `main.ts` / a `@nestjs/typeorm`-style `synchronize` hook.

Why:
- Race conditions: N replicas boot in parallel and each tries to acquire the migration lock; the losers retry / crash-loop.
- Slow rollouts: every replica blocks on the lock check before serving traffic. Adds latency to autoscaling events.
- Conflates release-phase work (one-shot, gated, observable) with runtime (continuous, redundant). A failed migration becomes a `CrashLoopBackOff` instead of a clear release-phase error.
- Reduces rollback agility — you can't roll back the app without also undoing migrations.

**Rule:** the app process must assume the schema is already at the target version when it starts. If it isn't, fail liveness, do not migrate.

---

## Pattern A: CI Pre-Deploy Step (default for this repo)

Wire migrations into your deploy workflow before the app deploy job runs. The included `.github/workflows/ci.yml` already validates idempotency in the `migration-smoke` job.

Production deploy outline (Pseudo, adapt to your CI):

```yaml
jobs:
  migrate:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @boilerplate/database run db:init-roles
        env:
          DATABASE_URL: ${{ secrets.PROD_DATABASE_URL }}
      - run: pnpm --filter @boilerplate/database run db:migrate
        env:
          DATABASE_URL: ${{ secrets.PROD_DATABASE_URL }}

  deploy:
    needs: migrate
    # ...your existing deploy job
```

Notes:
- `db:init-roles` is idempotent (uses `ALTER ROLE`); safe to rerun every deploy.
- Use a least-privilege migration role (DDL grants only) — distinct from the app's runtime role.
- If you use a VPC, run this job inside a self-hosted runner or via a bastion-friendly tunnel.

---

## Pattern B: Kubernetes Init Container

Embed migrations in the pod spec. Migrations run before the main container starts.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata: { name: onwealth-api }
spec:
  template:
    spec:
      initContainers:
        - name: migrate
          image: ghcr.io/your-org/onwealth-api:${TAG}
          command: ["pnpm", "--filter", "@boilerplate/database", "run", "db:migrate"]
          env:
            - name: DATABASE_URL
              valueFrom: { secretKeyRef: { name: db-credentials, key: url } }
      containers:
        - name: api
          image: ghcr.io/your-org/onwealth-api:${TAG}
          # ...
```

Caveats:
- N replicas → N init container invocations per rollout. Drizzle's migration table makes this safe but noisy in logs.
- Migration failure blocks rollout — combined with a `RollingUpdate` strategy and `maxUnavailable: 0`, you get safe automatic rollback.
- Init containers run on every pod restart (not just new releases). Acceptable because migrations are idempotent, but a degenerate case (broken migration, healthy old pods) can mean each restart re-attempts the migration.

---

## Pattern C: Kubernetes Job (Helm pre-upgrade hook)

One-shot Job that runs once per release, gated before the Deployment rolls out.

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: onwealth-api-migrate-${RELEASE}
  annotations:
    "helm.sh/hook": pre-install,pre-upgrade
    "helm.sh/hook-delete-policy": before-hook-creation,hook-succeeded
spec:
  backoffLimit: 1
  ttlSecondsAfterFinished: 86400
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: migrate
          image: ghcr.io/your-org/onwealth-api:${TAG}
          command: ["pnpm", "--filter", "@boilerplate/database", "run", "db:migrate"]
          env:
            - name: DATABASE_URL
              valueFrom: { secretKeyRef: { name: db-credentials, key: url } }
```

Notes:
- `backoffLimit: 1` prevents runaway retry storms on broken migrations.
- `ttlSecondsAfterFinished` cleans up completed Job objects after 24h.
- Use ArgoCD `PreSync` waves if you're on GitOps.
- Failed Job blocks the Helm release — operator alerted, app version unchanged. Clean rollback semantics.

---

## Local Development

For local dev (one developer, ephemeral DB):

```bash
pnpm db:dev    # init-roles + migrate, in order
```

This composite script lives at the workspace root and chains the two `@boilerplate/database` scripts.

---

## Pre-Flight Checklist (any pattern)

Before each production migration:

1. **Backup**: snapshot or PITR window confirmed.
2. **Migration role**: least-privilege role with DDL grants — never the app's runtime role.
3. **Lock timeout**: `00-init-role-timeouts.sql` sets `lock_timeout` per role. Confirm it's applied (`SHOW lock_timeout` while connected as the migration role).
4. **Dry run** in staging on a production-sized dataset for any migration touching >1M rows.
5. **Online migrations**: for large tables, use `CREATE INDEX CONCURRENTLY` (Drizzle: write raw SQL migration; `drizzle-kit` won't generate this for you).
6. **Rollback plan**: forward-only migrations are the default — if you need to revert, write a new migration. Avoid `drizzle-kit drop`.

---

## Health & Readiness Coupling

The `/readyz` probe depends on the DB. If a migration is in flight and holds an exclusive lock, `/readyz` will fail until the lock releases — by design.

Kubernetes uses `/readyz` for `readinessProbe`. During a release, new pods will hold themselves out of the Service until the schema is consistent. This is the intended ordering: **migrate → ready → traffic**.

---

## Branch Protection — Required Checks

Configure GitHub branch protection on `main` to require BOTH of the following CI status checks before merge:

- `ci` — lint / typecheck / test / build / architecture check
- `Migration Smoke Test` — empty-schema + idempotent migration run against an ephemeral Postgres

`Migration Smoke Test` is gated on `ci` via `needs: [ci]` in `.github/workflows/ci.yml` — broken builds short-circuit before the smoke job spins up Postgres. Branch protection must still list it explicitly; otherwise a manual re-run can bypass the dependency.

---

## Unresolved Questions

- Should we add a `--skip-already-applied` short-circuit in the init-container variant to cut cold-start time on multi-replica deploys?
- Do we need a separate "lock-timeout per migration" override, or is the role-level setting sufficient for all envisioned migrations?
