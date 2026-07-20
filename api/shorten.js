// Vercel Serverless Function — URL Shortener (is.gd proxy)
// Avoids CORS issues when calling is.gd from the browser

export default async function handler(req, res) {
  // Allow CORS for your frontend
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'URL parameter is required' });
  }

  // Only ever forward http(s) URLs to is.gd. Without this, this endpoint
  // is effectively an open proxy that will `fetch()` whatever scheme a
  // caller hands it (file:, ftp:, internal hostnames, etc).
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return res.status(400).json({ error: 'Only http/https URLs can be shortened' });
  }

  try {
    const encoded = encodeURIComponent(url);
    const response = await fetch(`https://is.gd/create.php?format=simple&url=${encoded}`);
    const shortUrl = await response.text();

    if (shortUrl.startsWith('Error:')) {
      return res.status(500).json({ error: shortUrl });
    }

    return res.status(200).json({ shortUrl: shortUrl.trim() });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to shorten URL', detail: err.message });
  }
}
