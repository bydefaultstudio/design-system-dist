-- Better Auth's own tables, for the options worker/auth.js passes it: core
-- (user, session, account, verification) plus rateLimit for
-- `rateLimit.storage: 'database'`. The email-OTP plugin adds no table of its
-- own — codes live in `verification`, hashed.
--
-- GENERATED, not typed: better-auth 1.7.5, via getMigrations() from
-- better-auth/db/migration — the same code path as `@better-auth/cli generate`
-- — against the config in worker/auth.js. Regenerate the same way after a
-- Better Auth upgrade rather than editing by hand, so the schema can never
-- drift from what the adapter expects. `date` columns are what its SQLite
-- dialect emits; the adapter does the conversion.
--
-- Apply:  npx wrangler d1 migrations apply design-system-auth          (local)
--         npx wrangler d1 migrations apply design-system-auth --remote (prod)

create table "user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" integer not null, "image" text, "createdAt" date not null, "updatedAt" date not null);

create table "session" ("id" text not null primary key, "expiresAt" date not null, "token" text not null unique, "createdAt" date not null, "updatedAt" date not null, "ipAddress" text, "userAgent" text, "userId" text not null references "user" ("id") on delete cascade);

create table "account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" date, "refreshTokenExpiresAt" date, "scope" text, "password" text, "createdAt" date not null, "updatedAt" date not null);

create table "verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" date not null, "createdAt" date not null, "updatedAt" date not null);

create table "rateLimit" ("id" text not null primary key, "key" text not null unique, "count" integer not null, "lastRequest" bigint not null);

create index "session_userId_idx" on "session" ("userId");

create index "account_userId_idx" on "account" ("userId");

create index "verification_identifier_idx" on "verification" ("identifier");