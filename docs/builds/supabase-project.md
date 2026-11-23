# Supabase project

The sync backend is a live Supabase project. This file records what exists so a
future session does not have to rediscover it.

## Project

| | |
| --- | --- |
| Project ref | `exolfkcfxgfutzoutldl` |
| URL | `https://exolfkcfxgfutzoutldl.supabase.co` |
| Plan | Free (500 MB database, 50k monthly users) |
| Region | set at creation; the CLI target is `db.exolfkcfxgfutzoutldl.supabase.co:5432` |

The publishable key is safe to ship in a build — row-level security is what
protects the data. The database password and any personal access token are
secrets: they are never committed, never written to `supabase/config.toml`, and
never printed in logs or error messages.

Local runs read the URL and publishable key from `apps/mobile-tv/.env`, which is
gitignored. CI supplies the same two values as repository variables.

## Schema

`supabase/config.toml` is committed so the migration history is reproducible.
Fourteen migrations create three tables:

- `public.user_preferences` — app locale, preferred audio and subtitle
  languages, subtitles enabled, autoplay, My List, favourite live-TV channels
- `public.user_addons` — installed add-ons and providers
- `public.user_watch_progress` — movie and episode resume positions

Apply them with:

```bash
npx supabase@latest db push \
  --db-url "postgresql://postgres:<password>@db.exolfkcfxgfutzoutldl.supabase.co:5432/postgres" \
  --include-all --yes
```

`--yes` is required in an agent run; the CLI otherwise refuses to confirm.
`npx supabase link` needs a personal access token and is not used here.

## Auth settings that matter

| Setting | Value | Why |
| --- | --- | --- |
| Anonymous sign-ins | **on** | the app is usable without an account; an account is an opt-in upgrade |
| Allow manual linking | **on** | lets a guest identity be attached to a real provider without losing their data |
| Confirm email | **on** for release builds | the app must not sign a new account in before the address is verified. The client already handles the "no session yet" answer: it shows "check your email" instead of letting anyone in |
| Site URL | the web origin (PWA) | where confirmation and recovery links land when no redirect is allowed |
| Redirect URLs | `moviestvflix://auth/reset`, web origin | allow-listed targets; without them Supabase falls back to Site URL and the native app never receives the tokens |
| Allow new users to sign up | **on** | |

`/auth/v1/settings` reports `mailer_autoconfirm: true` when confirmation is
**off**. The flag name is inverted from the dashboard toggle.

## Account security settings

| Setting | Value | Why |
| --- | --- | --- |
| Minimum password length | **8** | the client enforces 8–72 with at least one letter and one number; 72 is bcrypt's effective limit |
| Leaked password protection | **on** where the plan allows | rejects passwords seen in breaches (HaveIBeenPwned) |
| Email rate limits | default | keeps reset/confirmation mail from being used to spam an address |
| JWT expiry | default (1 h) | refresh tokens rotate through the client library |

The client also re-authenticates with the current password before changing it, so
an unlocked session alone cannot take over the account, and offers **Sign out
everywhere**, which revokes all refresh tokens rather than just this device.

## Account lifecycle in the client

- **Sign-up** calls `signUp` with an `emailRedirectTo`. If Supabase requires
  confirmation there is no session, and the screen says so instead of opening the
  app as a signed-in user.
- **Forgot password** sends `resetPasswordForEmail` with the same redirect.
- **Recovery**: the web build adopts the session from the URL fragment and
  Supabase emits `PASSWORD_RECOVERY`; the native build reads its own
  `moviestvflix://auth/reset` deep link, parses `access_token`/`refresh_token`,
  and calls `setSession`. Both paths land on "choose a new password", which calls
  `updateUser({ password })`.
- A confirmation link also carries tokens but has `type=signup`, so it never
  opens the reset screen.

## Verifying isolation

RLS policies are only real if an unrelated user is actually refused. The check
is a committed script, not a one-off:

```bash
cd apps/mobile-tv
SUPABASE_URL=https://exolfkcfxgfutzoutldl.supabase.co \
SUPABASE_PUBLISHABLE_KEY=sb_publishable_... \
node scripts/verify-rls.mjs
```

It creates two anonymous users, writes a row as the first, and proves the
second cannot read, insert into, or update that row. It refuses to run with a
secret key, so it cannot accidentally bypass the policies it is testing.

Result on 2026-11-18: **11/11 checks passed**.

## Known limits

- The free plan pauses a project after about a week of inactivity. That is fine
  while building; it must be upgraded or kept warm before real use.
- Anonymous users cannot delete themselves with the publishable key, so repeated
  runs of the check leave anonymous users behind. They hold no data.
- Google and Apple providers are not configured yet, so only email and
  anonymous sign-in work today.
