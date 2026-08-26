// ======================================================
// Share Module
// lz-string URL compression + is.gd shortener + QR code
// ======================================================

let qrInstance = null;

async function shareResume() {
  const data = collectFormData();
  const json = JSON.stringify(data);

  // Compress with lz-string
  const compressed = LZString.compressToEncodedURIComponent(json);
  const longUrl = `${window.location.origin}/view.html#${compressed}`;

  // Show modal immediately with long URL as fallback
  document.getElementById('shareUrl').value = longUrl;
  document.getElementById('shareModal').style.display = 'flex';

  // Generate QR from long URL first (will update if short URL succeeds)
  generateQR(longUrl);

  // Try to shorten. Only ever swap in the short URL if the API actually
  // returned one — any error response (or a malformed/missing shortUrl)
  // just leaves the long URL + its QR code in place, which already works.
  try {
    const res = await fetch(`/api/shorten?url=${encodeURIComponent(longUrl)}`);
    const result = await res.json();
    if (res.ok && result.shortUrl && /^https?:\/\//i.test(result.shortUrl)) {
      document.getElementById('shareUrl').value = result.shortUrl;
      generateQR(result.shortUrl);
    } else {
      console.warn('URL shortening failed, using full URL:', result.error || result);
    }
  } catch (e) {
    // Keep long URL — still works
    console.warn('URL shortening failed, using full URL:', e.message);
  }
}

function generateQR(url) {
  const container = document.getElementById('qrContainer');
  container.innerHTML = '';

  if (typeof QRCode === 'undefined') {
    container.innerHTML = '<p style="color:#888;font-size:12px">QR library loading...</p>';
    return;
  }

  qrInstance = new QRCode(container, {
    text: url,
    width: 180,
    height: 180,
    colorDark: '#1e293b',
    colorLight: '#ffffff',
    correctLevel: QRCode.CorrectLevel.M
  });
}

function copyShareUrl() {
  const urlInput = document.getElementById('shareUrl');
  const text = urlInput.value;

  // Fallback for browsers/contexts without the async Clipboard API
  // (e.g. non-HTTPS pages, or very old browsers).
  const legacyCopy = () => {
    urlInput.select();
    urlInput.setSelectionRange(0, 99999);
    try {
      document.execCommand('copy');
      showToast('✅ Link copied to clipboard!', 'success');
    } catch (e) {
      showToast('❌ Could not copy — please copy the link manually', 'error');
    }
  };

  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text)
      .then(() => showToast('✅ Link copied to clipboard!', 'success'))
      .catch(legacyCopy);
  } else {
    legacyCopy();
  }
}

function closeShareModal() {
  document.getElementById('shareModal').style.display = 'none';
}

// Close modal on backdrop click
document.addEventListener('DOMContentLoaded', () => {
  const modal = document.getElementById('shareModal');
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeShareModal();
    });
  }
});
