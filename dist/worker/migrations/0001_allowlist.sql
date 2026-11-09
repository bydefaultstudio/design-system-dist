-- Access gate — the tables that are ours. Better Auth's own tables (user,
-- session, account, verification, rateLimit) arrive in a later migration,
-- generated from the installed package rather than typed by hand, so the two
-- never drift.
--
-- Apply:  npx wrangler d1 migrations apply design-system-auth          (local)
--         npx wrangler d1 migrations apply design-system-auth --remote (prod)

-- The allowlist IS the policy (access-plan.md D5, §4.6): named people only,
-- so a row here is what admits someone and removing it is what stops the
-- next sign-in. It does not end a live session — revocation is this row
-- plus a DELETE from session (decided 2026-09-22). Emails are lowercased on
-- write and on lookup; SQLite's default collation would otherwise treat
-- Erlen@ and erlen@ as two people.
CREATE TABLE allowed_email (
  -- TEXT PRIMARY KEY alone still admits NULL in SQLite (only INTEGER PKs
  -- refuse it), and nothing but the CHECK stops a hand-typed Erlen@ from
  -- becoming a second row beside erlen@ — the admin path is a raw INSERT.
  email    TEXT PRIMARY KEY NOT NULL CHECK (email = lower(trim(email))),
  note     TEXT,                                  -- who this is, so the list stays readable
  added_at INTEGER NOT NULL DEFAULT (unixepoch()) -- unix seconds
);

-- Sliding-window counters for the OTP send endpoint (access-plan.md §4.8).
-- One row per send attempt, keyed "ip:<addr>" and "email:<addr>", both written
-- on every attempt BEFORE the allowlist is consulted so a listed and an
-- unlisted address do identical work and trip the limit identically. Rows
-- older than the window are swept lazily on the next attempt.
CREATE TABLE otp_send_log (
  key TEXT    NOT NULL,        -- "ip:…" or "email:…"
  at  INTEGER NOT NULL         -- unix seconds
);
CREATE INDEX otp_send_log_key_at ON otp_send_log (key, at); -- the per-key count
CREATE INDEX otp_send_log_at     ON otp_send_log (at);      -- the lazy sweep of expired rows
