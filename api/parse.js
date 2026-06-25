const crypto = require("crypto");

const MAX_IMAGE_CHARS = 18 * 1024 * 1024;
const MAX_BODY_BYTES = 20 * 1024 * 1024;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 30;
const DEFAULT_FREE_DAILY_LIMIT = 3;
const DEFAULT_STARTER_MONTHLY_LIMIT = 100;
const DEFAULT_PRO_MONTHLY_LIMIT = 500;
const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CACHE_MAX = 100;
const DEFAULT_AI_TIMEOUT_MS = 60 * 1000;
const rateBuckets = globalThis.__picstructRateBuckets || new Map();
const quotaBuckets = globalThis.__picstructQuotaBuckets || new Map();
const parseCache = globalThis.__picstructParseCache || new Map();
globalThis.__picstructRateBuckets = rateBuckets;
globalThis.__picstructQuotaBuckets = quotaBuckets;
globalThis.__picstructParseCache = parseCache;

module.exports = async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (!checkRateLimit(req)) {
    res.status(429).json({ error: "Too many requests" });
    return;
  }

  const contentLength = Number(req.headers["content-length"] || 0);
  if (contentLength > MAX_BODY_BYTES) {
    res.status(413).json({ error: "Request body is too large" });
    return;
  }

  const providerConfig = getProviderConfig();
  if (!providerConfig.apiKey || isPlaceholderKey(providerConfig.apiKey) || providerConfig.error) {
    res.status(501).json({ error: providerConfig.error || "AI API key is not configured" });
    return;
  }

  const plan = resolveRequestPlan(req);
  if (plan.error) {
    res.status(401).json({ error: plan.error });
    return;
  }

  try {
    const body = await readJsonBody(req, MAX_BODY_BYTES);
    const mode = body.mode === "chart" ? "chart" : "diagram";
    const output = normalizeOutput(mode, body.output);
    const detail = ["compact", "balanced", "audit"].includes(body.detail) ? body.detail : "balanced";
    const preset = normalizePreset(body.preset);
    const instructions = String(body.instructions || "").slice(0, 240);
    const image = String(body.image || "");
    const imageUrl = String(body.imageUrl || "");

    const imageInput = resolveImageInput({ image, imageUrl });
    const cacheKey = makeCacheKey({
      providerConfig,
      mode,
      output,
      detail,
      preset,
      instructions,
      image: imageInput
    });
    const cached = getCachedParse(cacheKey);
    if (cached) {
      res.status(200).json({
        ...cached,
        mode,
        output,
        detail,
        preset,
        instructions,
        fileName: body.fileName || "",
        plan: getPlanQuotaSnapshot(req, plan),
        cache: { hit: true }
      });
      return;
    }

    const quota = consumePlanQuota(req, plan);
    if (!quota.allowed) {
      res.status(402).json({
        error: `${plan.label} parse limit reached`,
        plan: toPublicPlan(plan, quota)
      });
      return;
    }

    let parsed;
    try {
      parsed = await parseWithProvider({
        providerConfig,
        mode,
        output,
        detail,
        preset,
        instructions,
        image: imageInput
      });
    } catch (error) {
      refundPlanQuota(req, plan);
      throw error;
    }

    setCachedParse(cacheKey, parsed);
    res.status(200).json({
      ...parsed,
      mode,
      output,
      detail,
      preset,
      instructions,
      fileName: body.fileName || "",
      plan: toPublicPlan(plan, quota),
      cache: { hit: false }
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      error: "Parse failed",
      detail: process.env.NODE_ENV === "development" ? String(error.message || error) : undefined
    });
  }
};
module.exports.getRuntimeHealth = getRuntimeHealth;

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-PicStruct-Access-Code");
}

async function readJsonBody(req, maxBytes) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body);

  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) {
      const error = new Error("Request body is too large");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(buffer);
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function checkRateLimit(req) {
  const key = getClientKey(req);
  const now = Date.now();
  const bucket = rateBuckets.get(key) || { start: now, count: 0 };

  if (now - bucket.start > RATE_LIMIT_WINDOW_MS) {
    bucket.start = now;
    bucket.count = 0;
  }

  bucket.count += 1;
  rateBuckets.set(key, bucket);
  return bucket.count <= RATE_LIMIT_MAX;
}

function resolveRequestPlan(req) {
  const plans = getPlanConfig();
  const accessCode = getAccessCode(req);

  if (!accessCode) return plans.free;
  if (plans.pro.accessCode && timingSafeEqual(accessCode, plans.pro.accessCode)) return plans.pro;
  if (plans.starter.accessCode && timingSafeEqual(accessCode, plans.starter.accessCode)) return plans.starter;

  return { error: "Invalid paid access code" };
}

function getPlanConfig() {
  return {
    free: {
      id: "free",
      label: "Free",
      window: "day",
      limit: envNumber("FREE_DAILY_PARSE_LIMIT", envNumber("DAILY_PARSE_LIMIT", DEFAULT_FREE_DAILY_LIMIT))
    },
    starter: {
      id: "starter",
      label: "Starter",
      window: "month",
      limit: envNumber("STARTER_MONTHLY_PARSE_LIMIT", DEFAULT_STARTER_MONTHLY_LIMIT),
      accessCode: cleanSecret(process.env.STARTER_ACCESS_CODE)
    },
    pro: {
      id: "pro",
      label: "Pro",
      window: "month",
      limit: envNumber("PRO_MONTHLY_PARSE_LIMIT", DEFAULT_PRO_MONTHLY_LIMIT),
      accessCode: cleanSecret(process.env.PRO_ACCESS_CODE)
    }
  };
}

function getRuntimeHealth() {
  const providerConfig = getProviderConfig();
  const plans = getPlanConfig();
  const keyConfigured = Boolean(providerConfig.apiKey && !isPlaceholderKey(providerConfig.apiKey));
  const providerReady = keyConfigured && !providerConfig.error;

  return {
    ok: providerReady,
    checkedAt: new Date().toISOString(),
    provider: {
      ready: providerReady,
      name: providerConfig.provider,
      type: providerConfig.type,
      model: providerConfig.model || "",
      baseUrlHost: safeUrlHost(providerConfig.baseUrl),
      apiKeyConfigured: keyConfigured,
      error: providerConfig.error || ""
    },
    limits: {
      rateLimitWindowMs: RATE_LIMIT_WINDOW_MS,
      rateLimitMax: RATE_LIMIT_MAX,
      maxBodyBytes: MAX_BODY_BYTES,
      maxImageChars: MAX_IMAGE_CHARS,
      plans: {
        free: publicPlanConfig(plans.free),
        starter: publicPlanConfig(plans.starter),
        pro: publicPlanConfig(plans.pro)
      }
    },
    cache: {
      ttlMs: envNumber("PARSE_CACHE_TTL_MS", DEFAULT_CACHE_TTL_MS),
      maxEntries: envNumber("PARSE_CACHE_MAX", DEFAULT_CACHE_MAX),
      currentEntries: parseCache.size
    },
    timeout: {
      aiRequestTimeoutMs: envNumber("AI_REQUEST_TIMEOUT_MS", DEFAULT_AI_TIMEOUT_MS)
    }
  };
}

function publicPlanConfig(plan) {
  return {
    id: plan.id,
    label: plan.label,
    window: plan.window,
    limit: plan.limit,
    accessCodeConfigured: Boolean(plan.accessCode)
  };
}

function consumePlanQuota(req, plan) {
  const limit = Number(plan.limit || 0);
  if (!Number.isFinite(limit) || limit < 1) {
    return {
      allowed: true,
      limit: 0,
      used: 0,
      remaining: null,
      resetAt: getResetAt(plan.window)
    };
  }

  const key = getQuotaBucketKey(req, plan);
  const current = quotaBuckets.get(key) || 0;

  if (current >= limit) {
    return {
      allowed: false,
      limit,
      used: current,
      remaining: 0,
      resetAt: getResetAt(plan.window)
    };
  }

  const used = current + 1;
  quotaBuckets.set(key, used);
  return {
    allowed: true,
    limit,
    used,
    remaining: Math.max(0, limit - used),
    resetAt: getResetAt(plan.window)
  };
}

function refundPlanQuota(req, plan) {
  const limit = Number(plan.limit || 0);
  if (!Number.isFinite(limit) || limit < 1) return;

  const key = getQuotaBucketKey(req, plan);
  const current = quotaBuckets.get(key) || 0;
  if (current <= 1) {
    quotaBuckets.delete(key);
    return;
  }

  quotaBuckets.set(key, current - 1);
}

function toPublicPlan(plan, quota) {
  return {
    id: plan.id,
    label: plan.label,
    window: plan.window,
    limit: quota.limit,
    used: quota.used,
    remaining: quota.remaining,
    resetAt: quota.resetAt
  };
}

function getPlanQuotaSnapshot(req, plan) {
  const limit = Number(plan.limit || 0);
  if (!Number.isFinite(limit) || limit < 1) {
    return toPublicPlan(plan, {
      limit: 0,
      used: 0,
      remaining: null,
      resetAt: getResetAt(plan.window)
    });
  }

  const key = getQuotaBucketKey(req, plan);
  const used = quotaBuckets.get(key) || 0;
  return toPublicPlan(plan, {
    limit,
    used,
    remaining: Math.max(0, limit - used),
    resetAt: getResetAt(plan.window)
  });
}

function getAccessCode(req) {
  const value = req.headers["x-picstruct-access-code"];
  return Array.isArray(value) ? String(value[0] || "").trim() : String(value || "").trim();
}

function getQuotaBucketKey(req, plan) {
  return `${plan.id}:${getPeriodKey(plan.window)}:${getClientKey(req)}`;
}

function envNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function cleanSecret(value) {
  return String(value || "").trim();
}

function safeUrlHost(value) {
  try {
    return new URL(String(value || "")).host;
  } catch (error) {
    return "";
  }
}

function timingSafeEqual(left, right) {
  if (!left || !right || left.length !== right.length) return false;

  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

function getPeriodKey(windowName) {
  const now = new Date();
  if (windowName === "month") return now.toISOString().slice(0, 7);
  return now.toISOString().slice(0, 10);
}

function getResetAt(windowName) {
  const now = new Date();
  if (windowName === "month") {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
  }

  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();
}

function getClientKey(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.socket?.remoteAddress || "unknown";
}

function makeCacheKey({ providerConfig, mode, output, detail, preset, instructions, image }) {
  const hash = crypto.createHash("sha256");
  hash.update(JSON.stringify({
    provider: providerConfig.provider,
    model: providerConfig.model,
    mode,
    output,
    detail,
    preset,
    instructions
  }));
  hash.update("\n");
  hash.update(image);
  return hash.digest("hex");
}

function getCachedParse(cacheKey) {
  const ttlMs = envNumber("PARSE_CACHE_TTL_MS", DEFAULT_CACHE_TTL_MS);
  if (!Number.isFinite(ttlMs) || ttlMs < 1) return null;

  const entry = parseCache.get(cacheKey);
  if (!entry) return null;

  if (Date.now() - entry.createdAt > ttlMs) {
    parseCache.delete(cacheKey);
    return null;
  }

  parseCache.delete(cacheKey);
  parseCache.set(cacheKey, entry);
  return cloneJson(entry.value);
}

function setCachedParse(cacheKey, parsed) {
  const ttlMs = envNumber("PARSE_CACHE_TTL_MS", DEFAULT_CACHE_TTL_MS);
  const maxEntries = envNumber("PARSE_CACHE_MAX", DEFAULT_CACHE_MAX);
  if (!Number.isFinite(ttlMs) || ttlMs < 1 || !Number.isFinite(maxEntries) || maxEntries < 1) return;

  parseCache.set(cacheKey, {
    createdAt: Date.now(),
    value: cloneJson(parsed)
  });

  while (parseCache.size > maxEntries) {
    const oldestKey = parseCache.keys().next().value;
    if (!oldestKey) break;
    parseCache.delete(oldestKey);
  }
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function resolveImageInput({ image, imageUrl }) {
  if (image) {
    if (!image.startsWith("data:image/")) {
      const error = new Error("Expected a data URL image");
      error.statusCode = 400;
      throw error;
    }

    if (image.length > MAX_IMAGE_CHARS) {
      const error = new Error("Image is too large");
      error.statusCode = 413;
      throw error;
    }

    return image;
  }

  if (imageUrl) {
    return validateImageUrl(imageUrl);
  }

  const error = new Error("Expected image or imageUrl");
  error.statusCode = 400;
  throw error;
}

function validateImageUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch (error) {
    const parseError = new Error("Invalid imageUrl");
    parseError.statusCode = 400;
    throw parseError;
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    const error = new Error("imageUrl must use HTTP or HTTPS");
    error.statusCode = 400;
    throw error;
  }

  if (url.href.length > 2048) {
    const error = new Error("imageUrl is too long");
    error.statusCode = 400;
    throw error;
  }

  const hostname = url.hostname.toLowerCase();
  const blockedHosts = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);
  if (blockedHosts.has(hostname) || hostname.endsWith(".local")) {
    const error = new Error("Private or local image URLs are not allowed");
    error.statusCode = 400;
    throw error;
  }

  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(hostname)) {
    const error = new Error("Private network image URLs are not allowed");
    error.statusCode = 400;
    throw error;
  }

  return url.href;
}

function normalizeOutput(mode, output) {
  const value = String(output || "");
  const allowed = mode === "chart"
    ? new Set(["csv", "markdown", "json"])
    : new Set(["mermaid", "markdown", "json"]);
  if (allowed.has(value)) return value;
  return mode === "chart" ? "csv" : "mermaid";
}

function normalizePreset(preset) {
  const value = String(preset || "");
  const allowed = new Set(["editable", "docs", "data", "accessibility"]);
  return allowed.has(value) ? value : "editable";
}

function getProviderConfig() {
  const provider = String(process.env.AI_PROVIDER || inferProvider()).toLowerCase();

  if (provider === "mimo") {
    return {
      provider,
      type: "chat",
      apiKey: process.env.MIMO_API_KEY || process.env.AI_API_KEY || "",
      baseUrl: trimTrailingSlash(process.env.AI_BASE_URL || "https://api.xiaomimimo.com/v1"),
      model: process.env.MIMO_MODEL || process.env.AI_MODEL || "mimo-v2.5"
    };
  }

  if (provider === "openai-compatible" || provider === "custom") {
    const baseUrl = trimTrailingSlash(process.env.AI_BASE_URL || "");
    return {
      provider,
      type: "chat",
      apiKey: process.env.AI_API_KEY || "",
      baseUrl,
      model: process.env.AI_MODEL || "",
      error: !baseUrl ? "AI_BASE_URL is required for openai-compatible provider" : ""
    };
  }

  return {
    provider: "openai",
    type: "responses",
    apiKey: process.env.OPENAI_API_KEY || process.env.AI_API_KEY || "",
    baseUrl: trimTrailingSlash(process.env.AI_BASE_URL || "https://api.openai.com/v1"),
    model: process.env.OPENAI_MODEL || process.env.AI_MODEL || "gpt-4.1-mini"
  };
}

function inferProvider() {
  if (process.env.MIMO_API_KEY) return "mimo";
  if (process.env.AI_BASE_URL && !/api\.openai\.com/i.test(process.env.AI_BASE_URL)) return "openai-compatible";
  return "openai";
}

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function isPlaceholderKey(value) {
  return /replace-with|your-key|sk-your-key/i.test(String(value || ""));
}

async function fetchWithTimeout(url, options) {
  const timeoutMs = envNumber("AI_REQUEST_TIMEOUT_MS", DEFAULT_AI_TIMEOUT_MS);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || typeof AbortController === "undefined") {
    return await fetch(url, options);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error(`AI request timed out after ${timeoutMs}ms`);
      timeoutError.statusCode = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function parseWithProvider(args) {
  if (args.providerConfig.type === "chat") {
    return await parseWithChatCompletions(args);
  }
  return await parseWithOpenAIResponses(args);
}

async function parseWithOpenAIResponses({ providerConfig, mode, output, detail, preset, instructions, image }) {
  const response = await fetchWithTimeout(`${providerConfig.baseUrl}/responses`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${providerConfig.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: providerConfig.model,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: systemPrompt()
            }
          ]
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: buildPrompt({ mode, output, detail, preset, instructions })
            },
            {
              type: "input_image",
              image_url: image
            }
          ]
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "picstruct_parse",
          strict: true,
          schema: responseSchema()
        }
      }
    })
  });

  const raw = await response.json();
  if (!response.ok) {
    throw new Error(raw.error?.message || `OpenAI request failed with ${response.status}`);
  }

  const text = extractOutputText(raw);
  const parsed = JSON.parse(text);

  return normalizeParsedResult(parsed, output);
}

async function parseWithChatCompletions({ providerConfig, mode, output, detail, preset, instructions, image }) {
  const response = await fetchWithTimeout(`${providerConfig.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${providerConfig.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: providerConfig.model,
      temperature: 0.1,
      response_format: chatResponseFormat(),
      messages: [
        {
          role: "system",
          content: systemPrompt()
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: [
                buildPrompt({ mode, output, detail, preset, instructions }),
                "",
                "Return only one valid JSON object with this shape:",
                JSON.stringify(responseSchema())
              ].join("\n")
            },
            {
              type: "image_url",
              image_url: {
                url: image
              }
            }
          ]
        }
      ]
    })
  });

  const raw = await response.json();
  if (!response.ok) {
    throw new Error(raw.error?.message || `${providerConfig.provider} request failed with ${response.status}`);
  }

  const text = extractChatText(raw);
  const parsed = JSON.parse(extractJsonObject(text));

  return normalizeParsedResult(parsed, output);
}

function systemPrompt() {
  return "You are PicStruct, a precise visual-structure extraction engine. Extract only what is visible. Return valid structured data. Do not invent hidden values. For uncertain chart values, estimate conservatively and mark confidence lower.";
}

function chatResponseFormat() {
  if (String(process.env.AI_RESPONSE_FORMAT || "json_object") === "json_schema") {
    return {
      type: "json_schema",
      json_schema: {
        name: "picstruct_parse",
        strict: true,
        schema: responseSchema()
      }
    };
  }

  return { type: "json_object" };
}

function buildPrompt({ mode, output, detail, preset, instructions }) {
  const presetGuidance = {
    editable: "Prioritize clean editable source that preserves visible labels and relationships.",
    docs: "Prioritize documentation-ready explanations, summaries, and readable naming.",
    data: "Prioritize structured data fidelity, table rows, axis labels, and exact visible values.",
    accessibility: "Prioritize concise descriptions suitable for alt text and accessibility review."
  };
  const userInstruction = instructions
    ? `User instruction: ${instructions}`
    : "User instruction: none.";

  if (mode === "chart") {
    return [
      `Task: convert this chart image into ${output}.`,
      "Extract title, chart type, axis labels, legend labels, categories, series, and data rows.",
      "For CSV, return a header row and data rows only in the code field.",
      "For Markdown, include a short summary and a fenced CSV block.",
      "For JSON, return a formatted JSON object in the code field.",
      "Always include csv with the best table representation and dataJson as a serialized JSON object.",
      "Do not wrap raw code, csv, mermaid, or dataJson values in Markdown fences unless the selected output is Markdown.",
      "Return a one-sentence summary and 1-4 warnings or review notes.",
      `Preset: ${preset}. ${presetGuidance[preset]}`,
      `Detail level: ${detail}.`,
      userInstruction
    ].join("\n");
  }

  return [
    `Task: convert this diagram or flowchart image into ${output}.`,
    "Extract visible nodes, labels, arrows, groups, and decision branches.",
    "For Mermaid, return valid Mermaid syntax in the code field.",
    "For Markdown, include a short summary and a fenced Mermaid block.",
    "For JSON, return a formatted JSON object in the code field.",
    "Always include mermaid with the best diagram representation and dataJson as a serialized JSON object.",
    "Do not wrap raw code, mermaid, csv, or dataJson values in Markdown fences unless the selected output is Markdown.",
    "Prefer flowchart TD unless the image clearly uses a left-to-right layout.",
    "Return a one-sentence summary and 1-4 warnings or review notes.",
    `Preset: ${preset}. ${presetGuidance[preset]}`,
    `Detail level: ${detail}.`,
    userInstruction
  ].join("\n");
}

function normalizeParsedResult(parsed, output) {
  const selectedOutput = String(output || "");
  return {
    previewType: parsed.previewType === "table" ? "table" : "mermaid",
    code: cleanGeneratedCode(parsed.code, selectedOutput),
    mermaid: cleanGeneratedCode(parsed.mermaid, "mermaid"),
    csv: cleanGeneratedCode(parsed.csv, "csv"),
    dataJson: cleanGeneratedCode(parsed.dataJson, "json"),
    metrics: parsed.metrics,
    summary: String(parsed.summary || "").trim(),
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map((warning) => String(warning).trim()).filter(Boolean) : []
  };
}

function cleanGeneratedCode(value, format) {
  let text = String(value || "").trim();
  if (!text || format === "markdown") return text;

  const fenced = text.match(/```(?:\s*[\w-]+)?\s*\r?\n([\s\S]*?)```/);
  if (fenced?.[1]) {
    text = fenced[1].trim();
  }

  if (format === "mermaid") {
    text = text.replace(/^\s*mermaid\s*\r?\n/i, "").trim();
  }

  if (format === "csv") {
    text = text.replace(/^\s*csv\s*\r?\n/i, "").trim();
  }

  if (format === "json") {
    text = text.replace(/^\s*json\s*\r?\n/i, "").trim();
  }

  return text;
}

function responseSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["previewType", "code", "mermaid", "csv", "dataJson", "metrics", "summary", "warnings"],
    properties: {
      previewType: {
        type: "string",
        enum: ["mermaid", "table"]
      },
      code: {
        type: "string",
        description: "The selected user-facing output."
      },
      mermaid: {
        type: "string",
        description: "Mermaid code when available, otherwise an empty string."
      },
      csv: {
        type: "string",
        description: "CSV table when available, otherwise an empty string."
      },
      dataJson: {
        type: "string",
        description: "A serialized JSON object containing the extracted structure."
      },
      summary: {
        type: "string",
        description: "One concise sentence explaining what was extracted."
      },
      warnings: {
        type: "array",
        minItems: 1,
        maxItems: 4,
        items: { type: "string" },
        description: "Review notes, uncertainty, or quality warnings."
      },
      metrics: {
        type: "object",
        additionalProperties: false,
        required: ["nodes", "links", "confidence"],
        properties: {
          nodes: { type: "integer" },
          links: { type: "integer" },
          confidence: { type: "string" }
        }
      }
    }
  };
}

function extractOutputText(raw) {
  if (raw.output_text) return raw.output_text;

  const parts = [];
  for (const item of raw.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") parts.push(content.text);
      if (typeof content.output_text === "string") parts.push(content.output_text);
    }
  }

  const text = parts.join("").trim();
  if (!text) throw new Error("OpenAI response did not include output text");
  return text;
}

function extractChatText(raw) {
  const content = raw.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();

  if (Array.isArray(content)) {
    return content
      .map((part) => typeof part.text === "string" ? part.text : "")
      .join("")
      .trim();
  }

  throw new Error("Chat completion response did not include message content");
}

function extractJsonObject(text) {
  const trimmed = String(text || "").trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    const inner = fenced[1].trim();
    if (inner.startsWith("{") && inner.endsWith("}")) return inner;
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1);
  }

  throw new Error("Model response did not contain a JSON object");
}
