// Vercel Serverless Function — URL Shortener (is.gd proxy)
// Avoids CORS issues when calling is.gd from the browser.
//
// Only this site's own share links (…/view.html#…) are shortened. Anything
// else is refused, so the endpoint can't be used by others as a free
// shortener (which could get the site's server blocked by is.gd).

const ALLOWED_HOSTS = new Set(['taimur-resume.vercel.app', 'localhost', '127.0.0.1']);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { url } = req.query;
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'URL parameter is required' });
  }
  if (url.length > 5000) {
    return res.status(400).json({ error: 'URL is too long to shorten' });
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  // Same site as the request (covers preview deployments), or a known host.
  const requestHost = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(':')[0];
  const sameSite = parsed.hostname === requestHost || ALLOWED_HOSTS.has(parsed.hostname);
  if (!/^https?:$/.test(parsed.protocol) || !sameSite || parsed.pathname !== '/view.html') {
    return res.status(400).json({ error: 'Only this site\'s resume links can be shortened' });
  }

  try {
    const response = await fetch(`https://is.gd/create.php?format=simple&url=${encodeURIComponent(url)}`);
    const shortUrl = (await response.text()).trim();

    // is.gd answers with a plain-text error message instead of a URL when
    // it can't shorten the link; only treat a real URL as success.
    if (!/^https?:\/\//i.test(shortUrl)) {
      return res.status(502).json({ error: shortUrl || 'is.gd did not return a short URL' });
    }

    return res.status(200).json({ shortUrl });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to shorten URL' });
  }
}
