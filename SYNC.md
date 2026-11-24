# Amazon Hub Tracker sync

This change set is branch/PR only. Do not merge or deploy until Eric approves.

The crossover contract matches [ROT Lead Scanner PR #2](https://github.com/Rotrepair/rot-lead-scanner/pull/2) (`README.md` on branch `cursor/rotr-command-center-sync-f62e`).

## Persistence (1)

The tracker already writes JSON to `HUB_DATA_DIR` (default `/data`):

- `amazon-hub-state.json` — packages, payroll entries, roster (source of truth)
- `amazon-hub-eta.json` — live driver ETA / SMS updates
- `amazon-hub-crossover.json` — Scanner-safe objects only
- `amazon-hub-connecteam-shifts.json` — imported Shift Report rows

This survives deploys only if Railway mounts a volume at `/data`. This PR does not add Postgres. The connected Railway account did not list the Hub Tracker project, so a volume is not verified from here.

## Token-auth import / export (2–3)

Set `HUB_SYNC_TOKEN` (or `ROT_CROSSOVER_TOKEN` / `ROT_API_TOKEN`). Never commit or print tokens.

- `POST /api/sync/import` — JSON, CSV, or a Connecteam Shift Report `.xlsx`. Dedupes package entries on `id` when present, otherwise `date|driver|hub|packages`. Upserts only; it does not delete payroll entries.
- `GET /api/sync/export?since=<ISO-8601>` — JSON with `updated_at` and `revision`. Optional `?format=csv`.
- Auth: `Authorization: Bearer <token>` or `X-Hub-Sync-Token`. If no token is configured, these routes return 503.

Use `/api/sync/export` for team bots only. The Scanner must not consume hub entries.

## Scanner crossover

Data shared with the Scanner is **only** `company_profile`, `availability`, and `crew_conflicts`. No Hub driver PII and no hiring leads.

Hub → Scanner: `POST {ROT_SCANNER_CROSSOVER_URL}` which should be the Scanner's `POST /api/v1/crossover/import`.

Sign the **raw body bytes** (compact JSON, UTF-8) as:

`X-ROTR-Signature: sha256=<hex HMAC-SHA256>`

The key is `ROT_HMAC_SECRET`. Send `Authorization: Bearer <ROT_CROSSOVER_TOKEN or ROT_API_TOKEN>` as well when that token is set. Do not re-serialize the body before signing.

Scanner → Hub: configure the Scanner's `HUB_WEBHOOK_URL` to:

`https://amazon-hub-tracker-production.up.railway.app/api/v1/crossover/webhook`

That endpoint accepts only:

- `company_profile.updated`
- `availability.upserted`
- `crew_conflict.upserted`

and verifies the same `X-ROTR-Signature` against the raw body. Other events are ignored (HTTP 200). If `ROT_HMAC_SECRET` is set, a missing or wrong signature is 401. If no HMAC secret and no sync token are configured, the route returns 503.

### Field names, types, and dedupe keys

`company_profile` key: `profile_key` (default `rotr`). Fields: `profile_key`, `legal_name`, `dba`, `owner_name`, `phone`, `email`, `website`, `address`, `city`, `state`, `postal_code`, `service_area`, `service_radius_miles`, `uei`, `cage`, `duns`, `contractor_registration`, `mbe_certification`, `tsb_certificate`, `naics`, `self_perform`, `trade_subs_note`, `insurance_notes`, `notes`, `updated_at`.

`availability` key: `ext:{external_id}:{source_app}` when `external_id` is set, otherwise `{normalized person_name}|{starts_at}|{ends_at}|{source_app}`. `kind` is `available`, `busy`, `off`, or `hub_day`. `starts_at` and `ends_at` are ISO-8601. Posts from this app use `source_app=hub`. Availability sent from the Hub may name Eric Pryor Sr. only.

`crew_conflicts` key: `ext:{external_id}:{source_app}` when `external_id` is set, otherwise `{normalized person_name}|{conflict_date}|{source_app}`. `conflict_date` is `YYYY-MM-DD`. `unavailable` is boolean. Name normalization matches Scanner `rot_v2.normalize` (`[^a-z0-9]+` → space, lowercased, trimmed).

`GET /api/v1/crossover?since=` and `POST /api/v1/crossover/import` use the same objects.

## Connecteam (free plan, no API)

Stay on the free plan. The feed is an import of the Connecteam **Shift Report** (Time Clock > Timesheets > Export > Shift Report, one row per shift) as `.xlsx`, or a CSV/JSON a bot posts after a browser read, through `POST /api/sync/import` (`?source=connecteam` or auto-detected). Dedupe key: Connecteam shift id when present, otherwise `driver+date+clock-in`. Shift rows are stored separately and are not written into payroll package entries.

`lib/connecteam.js` still has a disabled API stub. Do not sign up or request API access. Revisit a paid API only if we go over 10 users, the 2nd hub goes live, or after January 12, 2027.

## UI and API access

The hub UI and hub `/api/*` routes require an owner session (`HUB_UI_PASSWORD` plus `SESSION_SECRET`) or `Authorization: Bearer $HUB_API_TOKEN`. If either owner secret is unset, those routes stay closed. `/sms` stays open and checks `X-Twilio-Signature` with `TWILIO_AUTH_TOKEN`. `/api/sync/*` and `/api/v1/crossover/*` keep their existing token and HMAC checks. See `README.md`. The `X-Hub-Write` header is not used.

## Amazon Hub portal

The Hub portal has no public API. Package counts still come from manual / iCloud entries into this tracker.

## Active roster (defaults for empty state only)

Me (Eric, no payout), Valerie, Annette, Suzanne, Brianna (not weekends). Do not add AJ, Reva/Rev Fish, Tisha, or Aaron. Existing saved roster rows are not deleted by this PR (Ronna may still be in live data until Eric changes it).

The garage door code is never stored or shown.
