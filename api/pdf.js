// Vercel Serverless Function — vector PDF of a resume
//
// Opens the site's own print page (print.html) in headless Chrome, lets
// the same app.js code build the resume, and prints it. The PDF then holds
// real text and shapes, like the PDFs of professional resume sites: sharp
// at any zoom, a small file, and text that applicant tracking systems (ATS)
// read directly. The browser falls back to its own (picture-based) PDF if
// this function is unavailable (see pdf-export.js).
//
// Privacy (GDPR): the resume is only held in memory while its PDF is made;
// nothing is stored or logged.
// Protection against misuse:
// - Only resume data (JSON) is accepted, never HTML; the page escapes every
//   value (app.js), and only the site's own page is opened.
// - The headless browser may only load the site itself, its fonts/icons
//   CDNs and Supabase storage (photos); every other request is blocked, so
//   the endpoint can't be used to reach other servers.
// - Size cap, a request rate limit per visitor, no CORS headers.

import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { mkdir, writeFile, access } from 'node:fs/promises';

const SITE_URL = (process.env.SITE_URL || 'https://taimur-resume.vercel.app').replace(/\/+$/, '');
const SITE_HOST = new URL(SITE_URL).host;
const MAX_BODY_CHARS = 3_500_000;             // a photo included, well under Vercel's 4.5 MB
const RATE_LIMIT = { max: 12, windowMs: 60_000 };

const ALLOWED_HOSTS = new Set([
  SITE_HOST,
  'fonts.googleapis.com', 'fonts.gstatic.com',
  'cdnjs.cloudflare.com', 'cdn.jsdelivr.net'
]);

function allowedRequest(url) {
  if (url.startsWith('data:') || url.startsWith('blob:') || url === 'about:blank') return true;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    return ALLOWED_HOSTS.has(u.host) || u.host.endsWith('.supabase.co');
  } catch (e) {
    return false;
  }
}

// Same-site pages only (plus local development).
function allowedOrigin(origin) {
  if (!origin) return true; // same-origin requests may omit it
  try {
    const host = new URL(origin).host;
    return host === SITE_HOST || /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) || host.endsWith('-taimur-soft.vercel.app');
  } catch (e) {
    return false;
  }
}

// Small in-memory limit per visitor (per warm instance): enough to stop
// someone hammering the function, never in the way of normal use.
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter(t => now - t < RATE_LIMIT.windowMs);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return list.length > RATE_LIMIT.max;
}

// The server only has a Latin font. Chrome also finds fonts placed in
// /tmp/fonts (see @sparticuz/chromium), so the missing scripts are fetched
// once per instance, as TrueType (Google Fonts serves .ttf to simple
// clients): Bangla, and the arrows the templates use (↗ before project
// links, →).
const EXTRA_FONTS = [
  { file: 'NotoSansBengali', query: 'Noto+Sans+Bengali:wght@400;700' },
  { file: 'NotoSansMath', query: 'Noto+Sans+Math' }
];

async function ensureFonts() {
  const dir = '/tmp/fonts';
  await mkdir(dir, { recursive: true });
  await Promise.all(EXTRA_FONTS.map(async ({ file, query }) => {
    try { await access(`${dir}/${file}-400.ttf`); return; } catch (e) {}
    const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${query}`,
      { headers: { 'User-Agent': 'Mozilla/4.0' } })).text();
    const faces = [...css.matchAll(/font-weight:\s*(\d+);[\s\S]*?url\((https:[^)]+\.ttf)\)/g)];
    await Promise.all(faces.map(async ([, weight, url]) => {
      const res = await fetch(url);
      if (res.ok) await writeFile(`${dir}/${file}-${weight}.ttf`, Buffer.from(await res.arrayBuffer()));
    }));
  }));
}

// One browser per warm instance, reused by later requests.
let browserPromise = null;
async function getBrowser() {
  if (browserPromise) {
    const browser = await browserPromise.catch(() => null);
    if (browser && browser.connected) return browser;
    browserPromise = null;
  }
  browserPromise = (async () => {
    chromium.setGraphicsMode = false;
    const executablePath = await chromium.executablePath();
    try { await ensureFonts(); } catch (e) { console.warn('Extra fonts not available:', e.message); }
    return puppeteer.launch({
      args: await puppeteer.defaultArgs({ args: chromium.args, headless: 'shell' }),
      defaultViewport: { width: 1400, height: 1000, deviceScaleFactor: 1 },
      executablePath,
      headless: 'shell'
    });
  })();
  return browserPromise;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!allowedOrigin(req.headers.origin)) {
    return res.status(403).json({ error: 'Not allowed' });
  }
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (rateLimited(ip)) {
    return res.status(429).json({ error: 'Too many requests, please wait a minute' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    if (body.length > MAX_BODY_CHARS) return res.status(413).json({ error: 'Resume is too large' });
    try { body = JSON.parse(body); } catch (e) { return res.status(400).json({ error: 'Invalid JSON' }); }
  }
  const data = body && body.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return res.status(400).json({ error: 'Missing resume data' });
  }
  if (JSON.stringify(data).length > MAX_BODY_CHARS) {
    return res.status(413).json({ error: 'Resume is too large' });
  }

  let page = null;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', r => (allowedRequest(r.url()) ? r.continue() : r.abort('blockedbyclient')));

    await page.goto(`${SITE_URL}/print.html`, { waitUntil: 'networkidle0', timeout: 20_000 });
    const info = await page.evaluate(d => window.renderForPrint(d), data);

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      // The resume is laid out at its PDF width (600–660 px) and scaled to
      // the paper, exactly as the editor's layout choice measured it.
      scale: Math.min(2, Math.max(0.1, info.scale)),
      ...(info.pages <= 1 ? { pageRanges: '1' } : {}),
      tagged: true,
      timeout: 20_000
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Pdf-Pages', String(info.pages));
    return res.status(200).send(Buffer.from(pdf));
  } catch (err) {
    console.error('PDF generation failed:', err && err.message);
    return res.status(500).json({ error: 'PDF generation failed' });
  } finally {
    if (page) await page.close().catch(() => {});
  }
}
