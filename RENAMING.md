# Jamtytrack names and deployment

The GitHub repository is [JAMT-01/jamtytrack](https://github.com/JAMT-01/jamtytrack).
The public app remains at https://jamtytrack.montagnertudor.org.

Both `source` (React application) and `master` (production Worker) use the new
name. They remain separate application histories; deploying the React branch
over the production Worker can remove features. The rename uses the exact
downloaded production Worker with only naming substitutions and keeps its
existing static assets and secret bindings.

| Resource | Active name | Identifier |
| --- | --- | --- |
| Worker | `jamtytrack` | `6bf1979e63504a1bbfeb5015ec3735de` |
| D1 database | `jamtytrack` | `4fa3290f-cf68-410a-840e-8fb3a22561c2` |
| KV namespace | `jamtytrack-photos` | `cafdcdcb096c4b23b5978317a08a0fa1` |

The Worker is renamed through Cloudflare's PATCH Worker API using the immutable
ID; changing only the Wrangler name would create a separate Worker. D1's API
does not provide a database-name update. Its migration pauses requests and cron
writes, exports the complete database, imports it into the new database, and
checks every table before the production DB binding changes. Photo blobs stay
in the same KV namespace. Photo encryption records are copied byte for byte.

The original database is kept as a rollback backup, never used by the active
configuration. It contains sensitive data, just like the new database; do not
publish its export. After writes resume, rolling back must preserve new rows
and must not blindly switch to the old snapshot.

Completed on 2026-09-13: all 16 application tables (288 rows) matched before
cutover, including `photo_crypto`. The deployed version is
`35af7b1e-1b7d-44cb-9453-6ecb8812c491`. Health returned 200, private routes
remained gated, and the custom domain, KV identifier, secret bindings and cron
schedule were verified against the pre-migration snapshot.

Cookie names are `jamtytrack_session` and `jamtytrack_photos`, with distinct
`jamtytrack-session-v1` and `jamtytrack-photos-v1` HMAC contexts. Existing devices
sign in again once. Passwords and photo encryption derivation are unchanged.

Local research tools use `data/jamtytrack.db`. If only the old filename exists,
the SQLite backup API copies it, including committed WAL data, before use.
An existing new diary is never overwritten; the old file is kept as a backup.
The compatibility loader and its regression tests intentionally name the old
file so existing checkouts cannot silently start an empty diary.

## Repairs verified on 2026-09-13

Opening or refreshing `/api/auth/login` now serves the login form directly.
Previously, GET fell through to the app shell, whose protected scripts could
not load before sign-in. Production version
`16c16934-b1f6-4da4-8966-5004acb2ab30` includes that fix and the Habits repair.

Habits now mounts only in `nav.side-nav` or `nav.bottom-nav`. The former geometry
heuristic excluded the desktop sidebar and could select a meal row, clone its
delete/repeat controls, and change its grid. Only the mobile navigation gets a
fifth grid column. Switching layouts removes the stale item and restores its
highlight and grid before placing the new button. The injected script URL is
versioned so reloading picks up the repair immediately.

Live checks confirmed 50 meals, 91 meal items, two habits, and nine habit entries,
matching the pre-rename backup. The September 3 diary, saved-food list, a text
meal estimate, and both habit histories loaded. No diary records were changed.
The deployed DB, KV, assets, and secret bindings are unchanged. Four login route
tests passed; browser checks covered desktop, mobile, and resizing with Habits
open. `tools/stub-frontend.mjs` accepts `JAMTYTRACK_MEAL_FIXTURE=1` to reproduce
the populated meal row when testing injected clients locally.

The production `master` branch's `dist/worker.js` remains the recovered live
artifact, including later habit history UI changes absent from older recovery
sources. This repair updates its navigation helpers and `worker/habits-assets.ts`
selectively. Do not regenerate the entire bundle from `recovered/BUNDLE-FULL.js`
or deploy the `source` branch until all production features have been reconciled.
