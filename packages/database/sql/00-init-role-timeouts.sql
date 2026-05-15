-- Role-level timeout defaults for the application DB user.
-- Run once per environment BEFORE the first migration:
--   pnpm --filter @onwealth/database db:init-roles
--
-- Replace 'app_user' with the actual role from DATABASE_URL.
-- To parameterise across environments:
--   psql "$DATABASE_URL" -v role=myuser -f sql/00-init-role-timeouts.sql
--   ... then use :role in place of app_user below.
--
-- Why role-level rather than pool.on('connect') SET:
--   pool.on('connect') silently breaks under PgBouncer transaction mode
--   (each statement may arrive on a different server connection).
--   Role-level defaults are inherited by every connection regardless of
--   pooler mode (session / transaction / statement).
ALTER ROLE app_user SET statement_timeout = '30s';
ALTER ROLE app_user SET idle_in_transaction_session_timeout = '60s';
ALTER ROLE app_user SET lock_timeout = '10s';
