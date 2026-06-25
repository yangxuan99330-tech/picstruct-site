# PicStruct Launch Checklist

## Domain

- Point `picstruct.com` to the deployment host.
- Add `www.picstruct.com` as an alias.
- Redirect `www` to the root domain, or root to `www`, but choose one canonical host.

## Environment

Set production environment variables:

```text
AI_PROVIDER=mimo
AI_BASE_URL=https://api.xiaomimimo.com/v1
MIMO_API_KEY=sk-...
AI_MODEL=mimo-v2.5
```

Run:

```powershell
npm.cmd run check
npm.cmd run dev
```

Open:

```text
http://127.0.0.1:8788/
```

## Smoke Tests

- Load the homepage.
- Open `/api/health` and confirm provider readiness, limits, cache, and timeout settings.
- Switch between Diagram and Chart modes.
- Upload a local image.
- Paste a public image URL.
- Generate with no API key and confirm demo fallback.
- Confirm API timeout and provider failure show different fallback messages.
- Confirm invalid access code and file-size errors do not replace the current output with demo data.
- Generate with an API key and confirm AI parser status.
- Repeat the same image/settings and confirm the second response is cached.
- Temporarily force an AI provider failure and confirm server quota is refunded.
- Set a short `AI_REQUEST_TIMEOUT_MS` and confirm timeout returns without consuming quota.
- After the free server limit is reached, repeat a cached image and confirm it still returns.
- After the free server limit is reached, try a new image/settings combination and confirm the upgrade prompt appears.
- Save a test paid access code and confirm the quota strip switches to paid access.
- Copy output.
- Download Mermaid or CSV output.
- Open `/privacy.html`, `/terms.html`, `/contact.html`, and `/sitemap.xml`.

## Before Paid Traffic

- Replace placeholder contact copy with a real support address.
- Create hosted checkout links for Starter and Pro across card, Paddle, crypto, WeChat Pay, Alipay, and manual payment where needed.
- Paste public checkout URLs into `config.js` under `paymentLinks`.
- Open `checkout.html?plan=starter` and `checkout.html?plan=pro` and confirm configured methods are clickable.
- Set `FREE_DAILY_PARSE_LIMIT`, `STARTER_ACCESS_CODE`, `PRO_ACCESS_CODE`, `STARTER_MONTHLY_PARSE_LIMIT`, and `PRO_MONTHLY_PARSE_LIMIT`.
- Set `PARSE_CACHE_TTL_MS` and `PARSE_CACHE_MAX` for your hosting memory budget.
- Confirm `/api/health` does not expose API keys or access-code values.
- Keep access codes private and rotate them if they are shared publicly.
- Add analytics.
- Add error logging for `/api/parse`.
- Replace in-memory rate limiting with persistent edge/platform rate limiting before scaling traffic.
- Confirm file size limits match your model and hosting costs.
- Add billing only after the extraction quality is acceptable on real user files.
