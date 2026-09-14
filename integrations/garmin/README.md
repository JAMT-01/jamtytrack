# Garmin walking and running sync

Production Worker: `jamtytrack-garmin-sync`. Connection controls live in
**Settings → Garmin Connect**, alongside the other integrations. The existing
<https://jamtytrack.montagnertudor.org/garmin> bookmark redirects to that card.

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

`src/settings.ts` mounts the connection panel inside the existing Settings page,
using the same forms and client behavior as the private standalone fallback.
Controls are scoped to a shadow root so they cannot disable other Settings forms.
Leaving Settings disposes the countdown timer; returning fetches connection status
again. The panel only reads status on mount and does not trigger a Garmin sync.
The former Habits toolbar link has been removed.

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
15 minutes. After a Garmin rate-limit response, Jamtytrack imposes a one-hour
cooldown as a local safeguard; this is not a Garmin-provided retry deadline or a
guarantee that waiting will resolve the rejection. The connection page displays
the deadline and a countdown separately from request errors, and disables sign-in,
verification, and manual sync until the pause ends. No credentials are retried
automatically. Error responses carry the deadline even if the next status read
fails, and unrelated input errors cannot clear an active cooldown. Logs contain only
fixed error codes and counts, never passwords, tokens, upstream responses, or
activity titles/routes.

## Habit behavior

- The existing `Walk 10 km` habit is selected by ID, not name.
- Recorded `walking` activities and running activities (`running`, `street_running`,
  `track_running`, `trail_running`, `treadmill_running`, `indoor_running`, `ultra_run`,
  `virtual_run`, and `obstacle_run`) count. Hikes, cycling, multisport totals, and
  all-day steps do not. Activity IDs are unique, and distances remain in meters
  until summed. The legacy `normalizeWalks` helper name remains available to
  existing import scripts; it now normalizes both walks and runs.
- Garmin UTC start times are assigned to the app's configured timezone. Activity
  queries include an adjacent-day margin so timezone boundaries do not lose walks.
- Automatic history begins on the day of connection. **Fill previous days** in
  Settings explicitly imports recorded walks and runs from the habit's `started_on` date
  through today. It uses the same session, lock, distance threshold, and manual
  override rules; repeated imports do not create duplicate check-ins. The result
  lists daily distances and which missing days were added. A complete activity
  response is required before any diary changes, and the imported start date is
  saved in the same transaction so recent imported days remain eligible for sync.
- Each ordinary sync rechecks the last
  week, or the period since the last successful sync after an outage, whichever
  is longer. Older edits outside this window are not automatically rechecked.
- For a 10 km target, daily totals from 8 km up to (but excluding) 10 km create a
  completed habit day with streak credit and its actual distance. The app displays
  that entry as light orange / Almost there. Totals of 10 km or more reach the
  full goal. Other target values still require the full target distance. Totals
  below the threshold remain in `garmin_activities` without a habit entry.
- An edited activity can move an automatic entry between near-goal and full-goal
  states without adding another completion; dropping below the streak threshold
  removes only the auto-owned entry. No schema change is required: `value` holds
  the real kilometers, and the main app derives its completion appearance.
- Snapshot replacement and completion changes commit in one D1 batch. An invalid
  response or incomplete pagination fails before modifying habit records.
- Only entries owned by this integration are updated/removed. Manual app/Telegram
  edits transfer ownership through the main `checkIn` function. Manually removing
  an automatic check-in suppresses automatic recreation for that day.
- Disconnect removes credentials and imported activity metadata, retaining past
  completions as ordinary app history.

## Verification

23 connector tests cover 8/10 km distance boundaries, running subtypes, unchanged
thresholds for other targets, timezone boundaries, duplicates,
updates/deletions, manual overrides, transaction rollback, concurrency, encrypted
storage, MFA, rejected requests, and cooldown behavior in the API and browser
client (including failed status refreshes and timer expiry without requests),
plus an authenticated history import with near-goal runs, manual entries, and
repeat imports. The connection client also tests near-goal/full-goal copy and
non-10 km targets. TypeScript checks pass.
The main bundle has eight passing login and
gateway tests covering authentication and cross-origin requests.

Cloudflare deployment was tested directly: the connection status endpoint returns
200, requests without the service credential return 401, and Garmin's sign-in
public sign-in page returns 200 from the Worker. That public probe did not prove
authenticated access. The owner's first sign-in attempt at 18:25:40 UTC returned
a Garmin rate-limit response. No session was saved and no activities were imported.
The local cooldown expires at 19:25:40 UTC (16:25:40 in Buenos Aires). The precise
upstream login stage and reason for the rejection were not captured. Authenticated
activity access was unverified at that point. The owner subsequently connected
successfully; before the Settings move, production had an encrypted session,
sync enabled, no pending MFA or error, and a successful sync at 19:55:30 UTC.

Main app version at setup: `1246069c-0e3a-454e-a058-535324d5cca3`.
Connector version at setup: `eed6fea5-d9de-429b-b3c5-a71ad6fba671`.
Connector version with cooldown fix: `15e98662-815c-4456-b54f-266da0c6c67e`.
Main app version with Settings integration: `88b30764-a4cf-4d8e-ae31-a7a469a8bfbc`.
Connector version with Settings integration: `d4f73260-ab6f-4889-853c-77f040936e05`.
Connector version with history import: `944f25dc-c027-40e5-b8a3-400db4c43fd4`.
The existing 50 meals and nine habit entries were unchanged before connection.

The main app is the recovered `master` artifact. Do not deploy the separate
React `source` branch or regenerate the entire recovered bundle to apply changes;
doing so can omit features that exist only in the live artifact. Preserve the
main Worker's current assets and inherited secret bindings during uploads.
