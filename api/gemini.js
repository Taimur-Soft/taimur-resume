// Vercel Serverless Function — Gemini proxy for signed-in users
//
// Lets people use the AI tools without their own Gemini API key. The site
// owner's key lives only in the GEMINI_API_KEY environment variable on
// Vercel and never reaches the browser.
//
// Protection against misuse:
// - Only signed-in users (a valid Supabase session token is required).
// - A daily limit per user, counted in Supabase (see supabase/ai-usage.sql).
// - Only text prompts to two allowed models, with a capped size and output.
// - No CORS headers, so other websites can't call it from their pages.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jyotxikfaqfipaaqjufq.supabase.co';
// The public "publishable" key, the same one the website itself uses.
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_1so89K71w0YvMqbZmglooQ_RHe2Zvun';
const DAILY_LIMIT = Math.max(1, parseInt(process.env.AI_DAILY_LIMIT || '30', 10) || 30);

const MAIN_MODEL = 'gemini-flash-latest';
const FALLBACK_MODEL = 'gemini-2.5-flash-lite';
const RETRY_DELAYS_MS = [1000, 3000];
const MAX_PROMPT_CHARS = 20000;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Rebuilds the request from allowed fields only, so the endpoint can't be
// used for anything but the site's own text prompts.
function cleanRequest(body) {
  const contents = Array.isArray(body?.contents) ? body.contents : [];
  const texts = contents.flatMap(c => (Array.isArray(c?.parts) ? c.parts : []))
    .map(p => (typeof p?.text === 'string' ? p.text : ''))
    .filter(Boolean);
  const prompt = texts.join('\n');
  if (!prompt) return { error: 'Empty prompt' };
  if (prompt.length > MAX_PROMPT_CHARS) return { error: 'Prompt is too long' };

  const g = body.generationConfig || {};
  const generationConfig = {
    temperature: Math.min(1, Math.max(0, Number(g.temperature) || 0.3)),
    maxOutputTokens: Math.min(8192, Math.max(256, parseInt(g.maxOutputTokens, 10) || 2048))
  };
  if (g.responseMimeType === 'application/json') generationConfig.responseMimeType = 'application/json';
  // Always "low" thinking on the shared key: much faster, and the long
  // default thinking was what pushed requests past the time limit.
  generationConfig.thinkingConfig = { thinkingLevel: 'low' };
  return { request: { contents: [{ parts: [{ text: prompt }] }], generationConfig } };
}

function withoutThinking(request) {
  const { thinkingConfig, ...generationConfig } = request.generationConfig;
  return { ...request, generationConfig };
}

// Each Gemini call gets at most `timeoutMs`; a slow call counts as "busy"
// (408) so the next step can try again or switch to the faster model.
async function callGemini(model, request, apiKey, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(request),
      signal: controller.signal
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  } catch (err) {
    return { status: 408, data: { error: { message: err.name === 'AbortError' ? 'Timed out' : String(err.message || err) } } };
  } finally {
    clearTimeout(timer);
  }
}

const retryable = (s) => s === 429 || s === 408 || s >= 500;

// The whole answer has to arrive well inside Vercel's 60 s function limit,
// otherwise Vercel cuts the request off with a bare 504.
const TOTAL_BUDGET_MS = 50000;
const MAIN_CALL_MAX_MS = 30000;
const FALLBACK_MIN_MS = 12000;

// Main model first (retried only while there's time), then the lighter,
// faster model with whatever time is left. Done here, not in the browser,
// so one click uses one unit of the daily limit.
async function generate(request, apiKey) {
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  const left = () => deadline - Date.now();
  let req = request;
  let last;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (left() < FALLBACK_MIN_MS + 8000) break; // keep time for the fallback
    last = await callGemini(MAIN_MODEL, req, apiKey, Math.min(MAIN_CALL_MAX_MS, left() - FALLBACK_MIN_MS));
    if (last.status === 200) return last;
    if (last.status === 400 && req.generationConfig.thinkingConfig) {
      req = withoutThinking(req);
      attempt--;
      continue;
    }
    if (!retryable(last.status)) return last;
    // A timeout means the model is slow right now: go straight to the
    // faster model instead of waiting again.
    if (last.status === 408) break;
    if (attempt < RETRY_DELAYS_MS.length) await sleep(RETRY_DELAYS_MS[attempt]);
  }
  const fallback = await callGemini(FALLBACK_MODEL, withoutThinking(req), apiKey, left());
  return fallback.status === 200 ? fallback : (last || fallback);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'The site\'s AI service is not set up yet. Add your own free Gemini key in AI Tools to use it now.', code: 'not_configured' });
  }

  // 1. Who is asking? Must be a signed-in user of this site.
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Please sign in to use the AI tools.', code: 'signin' });

  let user;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}` }
    });
    if (!r.ok) return res.status(401).json({ error: 'Your session has expired. Please sign in again.', code: 'signin' });
    user = await r.json();
  } catch {
    return res.status(502).json({ error: 'Could not check your sign-in. Please try again.' });
  }
  if (!user?.id) return res.status(401).json({ error: 'Please sign in to use the AI tools.', code: 'signin' });

  // 2. Check the request before spending any of the user's daily limit.
  const { request, error } = cleanRequest(req.body);
  if (error) return res.status(400).json({ error });

  // 3. Count this use against the user's daily limit (atomic, in Supabase).
  let used;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/use_ai_quota`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: '{}'
    });
    if (!r.ok) {
      // Fail closed: without the limit, anyone signed in could use up the key.
      return res.status(503).json({ error: 'The AI usage limit is not set up yet. Add your own free Gemini key in AI Tools to use it now.', code: 'not_configured' });
    }
    used = Number(await r.json());
  } catch {
    return res.status(502).json({ error: 'Could not check your AI usage. Please try again.' });
  }
  if (!(used <= DAILY_LIMIT)) {
    return res.status(429).json({
      error: `You have used all ${DAILY_LIMIT} free AI requests for today. They reset tomorrow, or add your own free Gemini key in AI Tools for unlimited use.`,
      code: 'daily_limit'
    });
  }

  // 4. Ask Gemini.
  try {
    const { status, data } = await generate(request, apiKey);
    if (status === 200) {
      return res.status(200).json({ ...data, usage: { used, limit: DAILY_LIMIT } });
    }
    // A key problem is the site's, not the user's.
    if (status === 400 || status === 401 || status === 403) {
      console.error('Gemini rejected the site key or request:', status, data?.error?.message);
      return res.status(502).json({ error: 'The site\'s AI service is not working right now. Try again later, or add your own free Gemini key in AI Tools.' });
    }
    if (status === 429) {
      return res.status(503).json({ error: 'The free AI service is very busy right now. Please try again in a minute.' });
    }
    if (status === 408) {
      return res.status(503).json({ error: 'Gemini is taking too long right now. Please try again in a minute.' });
    }
    return res.status(503).json({ error: 'Google\'s AI servers are busy right now. Please try again in a minute.' });
  } catch (err) {
    console.error('Gemini request failed:', err);
    return res.status(502).json({ error: 'Could not reach the AI service. Please try again.' });
  }
}
