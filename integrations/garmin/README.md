# Garmin walking sync

Production Worker: `jamtytrack-garmin-sync`. Connection page:
<https://jamtytrack.montagnertudor.org/garmin> (also linked from Habits).

This is a personal, unofficial Garmin Connect integration. It uses the login,
MFA, token exchange, refresh, and activity-list protocol documented in the
MIT-licensed [python-garminconnect](https://github.com/cyberjunky/python-garminconnect)
project. See `UPSTREAM-LICENSE`. It uses ordinary Worker `fetch` requests. It does
not implement the upstream library's transport impersonation or alternate-login
strategy chain. A CAPTCHA, rejected cloud request, or failed authentication is
reported without trying to bypass it.

## Deployment and connection

The main application's existing login gate protects `/garmin` and
`/api/garmin/*`. `worker/garmin-proxy.js` is included in the recovered production
`dist/worker.js`, before the asset fallback. POST requests require the app's
origin. The proxy strips browser cookies and adds a dedicated service secret.
The connector's `workers.dev` and preview URLs are disabled.

Bindings:

- Main Worker: `GARMIN_SYNC` service binding to `jamtytrack-garmin-sync`, plus
  `GARMIN_SYNC_TOKEN` secret.
- Connector: same `GARMIN_SYNC_TOKEN`, a separate 32-byte hex `ENCRYPTION_KEY`,
  and the existing `DB` D1 binding. `wrangler.jsonc` contains no secret values.

`schema.sql` creates only the three `garmin_*` tables. It does not modify existing
diary tables. Apply it once with `pnpm exec wrangler d1 execute jamtytrack --remote
--file schema.sql`. Run these commands from this directory:

```text
pnpm install
pnpm exec wrangler types --include-runtime false
pnpm check
pnpm test
pnpm exec wrangler deploy
```

Secrets are set with Wrangler separately; `.dev.vars` is ignored. Do not rotate
`ENCRYPTION_KEY` without decrypting and re-encrypting stored sessions, or requiring
a new Garmin connection. The generated binding types use secret names from the
local development file; no values are generated into the types.

The first sign-in verifies authenticated activity access before saving the
session and enabling the scheduled sync. Passwords are never stored. MFA state
expires after ten minutes; sessions/MFA cookies are AES-GCM encrypted with a
Worker secret held outside D1. Authentication attempts are limited to five per
15 minutes, and Garmin rate limits impose a one-hour cooldown. Logs contain only
fixed error codes and counts, never passwords, tokens, upstream responses, or
activity titles/routes.

## Habit behavior

- The existing `Walk 10 km` habit is selected by ID, not name.
- Only `activityType.typeKey === "walking"` counts; runs/hikes and all-day steps
  do not. Activity IDs are unique, and distances remain in meters until summed.
- Garmin UTC start times are assigned to the app's configured timezone. Activity
  queries include an adjacent-day margin so timezone boundaries do not lose walks.
- Automatic history begins on the day of connection. Each sync rechecks the last
  week, or the period since the last successful sync after an outage, whichever
  is longer. Older edits outside this window are not automatically rechecked.
- Partial distances are stored in `garmin_activities`. Only reaching the target
  creates a completed habit day, since every `habit_entries` row counts as done.
- Snapshot replacement and completion changes commit in one D1 batch. An invalid
  response or incomplete pagination fails before modifying habit records.
- Only entries owned by this integration are updated/removed. Manual app/Telegram
  edits transfer ownership through the main `checkIn` function. Manually removing
  an automatic check-in suppresses automatic recreation for that day.
- Disconnect removes credentials and imported activity metadata, retaining past
  completions as ordinary app history.

## Verification on 2026-09-13

12 connector tests cover distance thresholds, timezone boundaries, duplicates,
updates/deletions, manual overrides, transaction rollback, concurrency, encrypted
storage, MFA, and rejected requests. The main bundle has seven passing login and
gateway tests covering authentication and cross-origin requests.

Cloudflare deployment was tested directly: the connection status endpoint returns
200, requests without the service credential return 401, and Garmin's sign-in
endpoint returns 200 from the Worker. The authenticated Garmin activity test still
requires the account owner to complete the connection page. The cron is deployed
but remains inactive until that test succeeds.

Main app version at setup: `1246069c-0e3a-454e-a058-535324d5cca3`.
Connector version at setup: `eed6fea5-d9de-429b-b3c5-a71ad6fba671`.
The existing 50 meals and nine habit entries were unchanged before connection.

The main app is the recovered `master` artifact. Do not deploy the separate
React `source` branch or regenerate the entire recovered bundle to apply changes;
doing so can omit features that exist only in the live artifact. Preserve the
main Worker's current assets and inherited secret bindings during uploads.
