import { NextResponse } from 'next/server';

export const maxDuration = 120;
export const dynamic = 'force-dynamic';

// ─── 1. ALLOWED ORIGINS ─────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  'https://shipsafe-sage.vercel.app',
  'http://localhost:3000',
  'http://localhost:3001',
];

function getClientIP(request) {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  );
}

function isOriginAllowed(request) {
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');

  if (origin && ALLOWED_ORIGINS.some(o => origin.startsWith(o))) return true;
  if (referer && ALLOWED_ORIGINS.some(o => referer.startsWith(o))) return true;

  return false;
}

// ─── 2. RATE LIMITING (in-memory, resets on cold start) ─────────────
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = 15;           // 15 requests per window

const rateLimitMap = new Map(); // IP -> { count, resetAt }

// Clean up stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now > entry.resetAt) rateLimitMap.delete(ip);
  }
}, 5 * 60_000);

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true; // allowed
  }

  entry.count += 1;
  return entry.count <= RATE_LIMIT_MAX;
}

// ─── 3. PAYLOAD VALIDATION ──────────────────────────────────────────
const ALLOWED_MODELS = ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001'];
const MAX_TOKENS_LIMIT = 16384;
const MAX_BODY_SIZE = 5 * 1024 * 1024; // 5 MB

function validateBody(body, rawSize) {
  if (rawSize > MAX_BODY_SIZE) {
    return 'Request body exceeds 5 MB limit';
  }

  if (!body || typeof body !== 'object') {
    return 'Request body must be a JSON object';
  }

  if (typeof body.model !== 'string' || !body.model) {
    return 'Missing or invalid "model" field';
  }

  if (!ALLOWED_MODELS.includes(body.model)) {
    return `Model "${body.model}" is not allowed. Use: ${ALLOWED_MODELS.join(', ')}`;
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return 'Missing or empty "messages" array';
  }

  if (typeof body.max_tokens !== 'number' || body.max_tokens <= 0) {
    return 'Missing or invalid "max_tokens" (must be a positive number)';
  }

  if (body.max_tokens > MAX_TOKENS_LIMIT) {
    return `"max_tokens" exceeds limit of ${MAX_TOKENS_LIMIT}`;
  }

  return null; // valid
}

// ─── 4. ERROR LOGGING ───────────────────────────────────────────────
function logBlocked(status, ip, reason) {
  console.error(
    JSON.stringify({
      blocked: true,
      status,
      ip,
      reason,
      timestamp: new Date().toISOString(),
    })
  );
}

// ─── HANDLER ────────────────────────────────────────────────────────
export async function POST(request) {
  const ip = getClientIP(request);

  // 1. Origin check
  if (!isOriginAllowed(request)) {
    logBlocked(403, ip, 'Origin/Referer not allowed');
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // 2. Rate limit
  if (!checkRateLimit(ip)) {
    logBlocked(429, ip, 'Rate limit exceeded');
    return NextResponse.json(
      { error: 'Too many requests. Try again in 60 seconds.' },
      { status: 429 }
    );
  }

  try {
    // Read raw body for size check, then parse
    const rawBody = await request.text();
    let body;
    try {
      body = JSON.parse(rawBody);
    } catch {
      logBlocked(400, ip, 'Invalid JSON');
      return NextResponse.json(
        { error: 'Invalid request', reason: 'Body is not valid JSON' },
        { status: 400 }
      );
    }

    // 3. Payload validation
    const validationError = validateBody(body, rawBody.length);
    if (validationError) {
      logBlocked(400, ip, validationError);
      return NextResponse.json(
        { error: 'Invalid request', reason: validationError },
        { status: 400 }
      );
    }

    // ── Existing streaming logic (untouched) ──

    // Add stream:true to the request
    body.stream = true;

    // Build headers — add web search beta header if tools include web_search
    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    };
    if (body.tools?.some(t => t.type?.startsWith('web_search'))) {
      headers['anthropic-beta'] = 'web-search-2025-03-05';
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errData = await response.json();
      return NextResponse.json(errData, { status: response.status });
    }

    // Stream the response through — keeps Vercel connection alive
    return new Response(response.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
