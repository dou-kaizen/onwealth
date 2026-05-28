-- Role-level timeout defaults for the application DB role.
-- Run once per environment BEFORE the first migration, connected via DATABASE_URL:
--   pnpm --filter @boilerplate/database db:init-roles
--
-- Applies to current_user -- the role embedded in DATABASE_URL -- so no
-- parameterisation is needed across environments. statement_timeout,
-- lock_timeout and idle_in_transaction_session_timeout are USERSET settings:
-- a role may set them on itself without superuser privileges.
--
-- Why role-level rather than pool.on('connect') SET:
--   pool.on('connect') silently breaks under PgBouncer transaction mode
--   (each statement may arrive on a different server connection).
--   Role-level defaults are inherited by every connection regardless of
--   pooler mode (session / transaction / statement).
DO $$
BEGIN
  EXECUTE format('ALTER ROLE %I SET statement_timeout = %L', current_user, '30s');
  EXECUTE format('ALTER ROLE %I SET idle_in_transaction_session_timeout = %L', current_user, '60s');
  EXECUTE format('ALTER ROLE %I SET lock_timeout = %L', current_user, '10s');
END $$;
