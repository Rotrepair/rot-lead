# Amazon Hub Tracker

The hub is owner-only. Driver texts still come in through `/sms`.

## Access

Pages and hub `/api/*` routes stay closed until one of these is sent:

- An owner session. Sign in at `/login` with `HUB_UI_PASSWORD`. The cookie is signed with `SESSION_SECRET`.
- `Authorization: Bearer <HUB_API_TOKEN>` for bot scripts.

`/login` and `/logout` are the only open pages. A request with no session and no token gets a redirect to `/login`, or `401` on `/api/*`. No roster, pay, hours, miles, or expense data is included.

`/sms` stays open so Twilio can deliver driver texts. Every POST must carry a valid `X-Twilio-Signature` for `TWILIO_AUTH_TOKEN`. A bad or missing signature is `403`, and the text is not saved.

`/api/sync/*` and `/api/v1/crossover/*` keep their existing sync token and HMAC checks. They are not public. They do not use the old write header.

The old `X-Hub-Write: explicit-v2` header is not checked and does not grant access.

Do not commit these values. Set them in Railway.

## Railway env vars

| Variable | If it is missing |
| --- | --- |
| `HUB_UI_PASSWORD` | The owner cannot sign in. The UI and hub APIs stay closed. The process keeps running. |
| `SESSION_SECRET` | Sign-in cannot start a session, even with the right password. `HUB_UI_SESSION_SECRET` is accepted when `SESSION_SECRET` is unset. The process keeps running. |
| `HUB_API_TOKEN` | Bot calls to hub `/api/*` routes return `401`. The owner session still works. |
| `TWILIO_AUTH_TOKEN` | `/sms` returns `403`, so driver texts are not saved. The site keeps running. |

Set `HUB_UI_PASSWORD` and `SESSION_SECRET` before deploying. Without them the owner cannot open the hub.

The signature check uses the public URL Twilio called: `X-Forwarded-Proto`, then `X-Forwarded-Host` (or `Host`), then the path. That matches `https://amazon-hub-tracker-production.up.railway.app/sms` on Railway.

## Bot scripts (Love's Hub)

Scripts that read or write `/api/hub-state`, or any other hub `/api/*` route, send the token on each request. Same-origin browser calls from a signed-in owner do not need the header; the session cookie is enough.

```bash
curl -sS "https://amazon-hub-tracker-production.up.railway.app/api/hub-state" \
  -H "Authorization: Bearer $HUB_API_TOKEN"
```

Writes use the same header and a JSON body:

```bash
curl -sS -X POST "https://amazon-hub-tracker-production.up.railway.app/api/hub-state" \
  -H "Authorization: Bearer $HUB_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary @payload.json
```

Do not put the token in a URL, a query string, or the repo. Keep it in the script's environment.

Sync and Scanner calls are unchanged: `HUB_SYNC_TOKEN` / `ROT_CROSSOVER_TOKEN` / `ROT_API_TOKEN`, and `X-ROTR-Signature` on crossover posts.
