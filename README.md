# PicStruct

PicStruct is a static MVP for converting visual files into editable structure:

- Diagram image to Mermaid
- Flowchart image to Markdown
- Chart image to CSV
- Visual extraction to JSON

The current site includes a local demo parser so the UI works without an API key.

## Run locally

Double-click `serve-site.bat`, or run:

```powershell
npm.cmd run dev
```

Open `http://127.0.0.1:8788/`.

The dev server serves the static site, `/api/parse`, and `/api/health`. Without a configured model API key, the parse endpoint returns a configuration error and the frontend falls back to demo output.

## Does this need an AI API?

For production, yes. The real parser needs a vision-capable model because the browser cannot reliably infer labels, arrows, chart axes, and plotted values by itself.

Do not put model API keys in frontend JavaScript. This repo includes a Vercel-style serverless endpoint at `api/parse.js`.

For MiMo V2.5, set these environment variables:

```text
AI_PROVIDER=mimo
AI_BASE_URL=https://api.xiaomimimo.com/v1
MIMO_API_KEY=sk-...
AI_MODEL=mimo-v2.5
```

For OpenAI, use:

```text
AI_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4.1-mini
```

For any OpenAI-compatible chat completion provider, use:

```text
AI_PROVIDER=openai-compatible
AI_BASE_URL=https://provider.example.com/v1
AI_API_KEY=sk-...
AI_MODEL=provider-vision-model
```

`AI_MODEL` must be a vision or multimodal model. Pure text models cannot parse charts or diagrams from images.

For local development, copy `.env.example` to `.env`. The included `dev-server.js` loads `.env` automatically.

The frontend calls:

```text
POST /api/parse
Content-Type: application/json

{
  "mode": "diagram" | "chart",
  "output": "mermaid" | "csv" | "markdown" | "json",
  "preset": "editable" | "docs" | "data" | "accessibility",
  "instructions": "Optional user guidance",
  "image": "data:image/png;base64,...",
  "imageUrl": "https://example.com/chart.png"
}
```

Send either `image` or `imageUrl`. Uploaded files are sent as data URLs. Pasted image links are sent as `imageUrl`.

Health check:

```text
GET /api/health
```

The health response reports provider readiness, provider name, model, base URL
host, limit settings, cache settings, timeout settings, and whether paid access
codes are configured. It never returns API keys, access-code values, bank details,
or payment secrets.

Expected response:

```json
{
  "code": "flowchart TD\n  A[Start] --> B[Review]",
  "previewType": "mermaid",
  "mermaid": "flowchart TD\n  A[Start] --> B[Review]",
  "csv": "",
  "dataJson": "{\"type\":\"diagram\",\"nodes\":[],\"edges\":[]}",
  "summary": "Detected a simple two-step flow.",
  "warnings": ["Review labels before publishing."],
  "metrics": {
    "nodes": 2,
    "links": 1,
    "confidence": "0.86"
  }
}
```

Good deployment options:

- Vercel function using `api/parse.js`
- Cloudflare Worker
- Netlify function
- Small Node/Express API

Model candidates:

- OpenAI vision-capable model
- Gemini vision model
- Claude vision model

For launch, start with one provider and keep the response schema stable.

## Frontend fallback behavior

`script.js` tries `/api/parse` only when the page is served over HTTP. If the
endpoint is missing, the API key is not configured, the model times out, or the
model request fails, the UI falls back to the built-in demo result with a reason
specific toast. Blocking errors such as invalid access codes, file-size failures,
rate limits, or quota limits do not render a new demo result; they keep the
current output visible and show the relevant message.

## Limits in this MVP

- Frontend upload limit: 10 MB.
- API request body limit: 20 MB.
- API image payload limit: roughly 18 MB as a data URL.
- Remote image URL limit: 2,048 characters; local/private hosts are blocked.
- In-memory rate limit: 30 parse requests per minute per client key.
- Free server parse limit: `FREE_DAILY_PARSE_LIMIT`, default 3 per day per client key.
- Starter server parse limit: `STARTER_MONTHLY_PARSE_LIMIT`, default 100 per month per client key.
- Pro server parse limit: `PRO_MONTHLY_PARSE_LIMIT`, default 500 per month per client key.
- In-memory parse cache: `PARSE_CACHE_TTL_MS`, default 24 hours; `PARSE_CACHE_MAX`, default 100 entries.
- AI provider request timeout: `AI_REQUEST_TIMEOUT_MS`, default 60 seconds.
- Frontend API wait timeout: `apiTimeoutMs` in `config.js`, default 75 seconds.
- Frontend free quota display: synced from server responses and stored in `localStorage` for display only.

Use stronger persistent rate limiting before public launch.

The cache key includes provider, model, mode, output format, detail level, preset,
custom instructions, and the image input. Cache hits do not call the AI provider
and do not consume server quota. The frontend still sends requests after the
displayed free count is full so the server can return cached results or a real
quota error.

Server quota is consumed only after the request passes validation and has quota
available. If the AI provider fails or returns unusable output, PicStruct refunds
that reserved quota so failed parses do not cost the user a conversion.
Provider timeouts use the same refund path.

## Billing MVP

Pricing buttons open `checkout.html`, which reads public hosted checkout URLs from
`config.js`.

Start with hosted checkout links from Stripe, Paddle, Lemon Squeezy, a crypto
checkout provider, WeChat Pay, Alipay, or manual payment instructions. See
`BILLING.md`.

For early paid tests, set `STARTER_ACCESS_CODE` and `PRO_ACCESS_CODE` in `.env`.
Paid users paste an access code into the pricing section; the API verifies it
server-side before applying paid monthly limits.

Do not put secret payment keys or payout details in frontend code.
