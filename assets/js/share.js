// ======================================================
// Share Module
// Signed in: a short private link (view.html?r=CODE) stored in the user's
//   own Supabase (supabase/share.sql). It always shows the latest version
//   of the resume, counts views, can hide phone/address, and can be turned
//   off. No third party sees the resume.
// Signed out: the resume packed into the link itself (lz-string), without
//   the photo so it stays short.
// Both: a styled QR code (template colour, rounded dots, initials in the
//   middle) that can be downloaded, plus one-click sharing.
// ======================================================

const SHARE_CODE_LEN = 10;
let shareState = null; // { mode: 'live' | 'link', url, code?, views?, hideContact?, name }

// ── Entry point (Share button) ─────────────────────────
async function shareResume() {
  const modal = document.getElementById('shareModal');
  modal.style.display = 'flex';
  setShareView('loading');

  const data = collectFormData();
  const p = data.personal;
  const name = [p.firstname, p.lastname].filter(Boolean).join(' ');
  if (!name && !p.designation) {
    setShareView('error', 'Fill in at least your name first, then share.');
    return;
  }

  if (typeof currentUser !== 'undefined' && currentUser) {
    try {
      await shareLive(name);
      return;
    } catch (err) {
      if (err.code !== 'not_setup') {
        setShareView('error', err.message || 'Could not create the link. Please try again.');
        return;
      }
      console.warn('Share links are not set up on the server yet; using a packed link.');
    }
  }
  await sharePacked(data, name);
}

// ── Signed in: short live link ─────────────────────────
function randomShareCode() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(SHARE_CODE_LEN));
  return [...bytes].map(b => abc[b % abc.length]).join('');
}

function isMissingTable(error) {
  return !!error && (error.code === '42P01' || error.code === 'PGRST205' ||
    /resume_shares|schema cache|does not exist/i.test(error.message || ''));
}

async function shareLive(name) {
  // The link points at the saved resume, so save what's on screen first.
  if (hasUnsyncedChanges() || !currentCloudResumeId) {
    clearTimeout(autoSyncTimer);
    autoSyncTimer = null;
    await silentSaveToCloud();
  }
  if (!currentCloudResumeId) {
    throw new Error('Your resume could not be saved yet, so it can\'t be shared. Check your connection and try again.');
  }

  let { data: row, error } = await supabaseClient
    .from('resume_shares')
    .select('id, hide_contact, views')
    .eq('resume_id', currentCloudResumeId)
    .maybeSingle();
  if (isMissingTable(error)) throw Object.assign(new Error('not set up'), { code: 'not_setup' });
  if (error) throw error;

  if (!row) {
    for (let attempt = 0; attempt < 3 && !row; attempt++) {
      const res = await supabaseClient
        .from('resume_shares')
        .insert({ id: randomShareCode(), resume_id: currentCloudResumeId })
        .select('id, hide_contact, views')
        .single();
      if (isMissingTable(res.error)) throw Object.assign(new Error('not set up'), { code: 'not_setup' });
      if (res.error && res.error.code !== '23505') throw res.error; // 23505 = code taken, try another
      row = res.data;
    }
    if (!row) throw new Error('Could not create a link. Please try again.');
  }

  shareState = {
    mode: 'live',
    code: row.id,
    url: `${location.origin}/view.html?r=${row.id}`,
    views: row.views || 0,
    hideContact: !!row.hide_contact,
    name
  };
  renderShare();
}

async function setShareHideContact(hide) {
  if (!shareState || shareState.mode !== 'live') return;
  const { error } = await supabaseClient.from('resume_shares').update({ hide_contact: hide }).eq('id', shareState.code);
  if (error) {
    showToast('❌ Could not update: ' + error.message, 'error');
    document.getElementById('shareHideContact').checked = !hide;
    return;
  }
  shareState.hideContact = hide;
  showToast(hide ? '✅ Phone and address are now hidden on your shared page' : '✅ Phone and address are shown on your shared page', 'success');
}

async function stopSharing() {
  if (!shareState || shareState.mode !== 'live') return;
  const btn = document.getElementById('shareStopBtn');
  btn.disabled = true;
  const { error } = await supabaseClient.from('resume_shares').delete().eq('id', shareState.code);
  btn.disabled = false;
  if (error) {
    showToast('❌ Could not turn off the link: ' + error.message, 'error');
    return;
  }
  shareState = null;
  setShareView('stopped');
  showToast('✅ Link turned off. Anyone opening it now sees that it no longer exists.', 'success');
}

// ── Signed out (or not set up): link that carries the resume ──
async function sharePacked(data, name) {
  // The photo alone would make the link tens of thousands of characters.
  const light = { ...data, personal: { ...data.personal, image: '' } };
  const url = `${location.origin}/view.html#${LZString.compressToEncodedURIComponent(JSON.stringify(light))}`;
  shareState = { mode: 'link', url, name, hadPhoto: !!data.personal.image };
  renderShare();

  // Too long for a QR code: a shortened link fits. (Only then is the link
  // sent to the shortening service.)
  if (!buildQR(url)) {
    try {
      const res = await fetch(`/api/shorten?url=${encodeURIComponent(url)}`);
      const result = await res.json();
      if (res.ok && /^https?:\/\//i.test(result.shortUrl || '') && shareState?.url === url) {
        shareState.url = result.shortUrl;
        renderShare();
      }
    } catch (e) { /* the long link still works */ }
  }
}

// ── QR code ────────────────────────────────────────────
// Strongest error correction that fits, so the initials badge in the
// middle never stops it scanning. Returns null if the text is too long.
function buildQR(text) {
  if (typeof qrcode === 'undefined') return null;
  for (const [level, badge] of [['H', true], ['Q', true], ['M', false], ['L', false]]) {
    try {
      const qr = qrcode(0, level);
      qr.addData(text);
      qr.make();
      return { qr, badge };
    } catch (e) { /* too long for this level */ }
  }
  return null;
}

function shareAccent() {
  const el = document.querySelector('#resumePreview .rv-eu') || document.getElementById('resumePreview');
  let c = el ? getComputedStyle(el).getPropertyValue('--resume-accent').trim() : '';
  const probe = document.createElement('canvas').getContext('2d');
  probe.fillStyle = '#0b1f4d';
  probe.fillStyle = c || '#0b1f4d';
  c = probe.fillStyle; // normalised to #rrggbb
  // QR codes need dark-on-light: fall back to navy for light accents.
  const n = parseInt(c.slice(1), 16);
  const lum = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  return lum > 0.5 ? '#0b1f4d' : c;
}

function shareInitials(name) {
  return (name || 'CV').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || 'CV';
}

// Draws the QR: "liquid" modules (neighbours join up, outer corners are
// rounded), rounded finder eyes, initials badge. Separate round dots look
// nice but the gaps between them stop scanners reading the code, so every
// module still fills its whole square. size in canvas px; caption
// (optional) adds a line of text underneath.
function drawQR(canvas, built, size, color, initials, caption) {
  const { qr, badge } = built;
  const n = qr.getModuleCount();
  const quiet = 3;
  const cell = size / (n + quiet * 2);
  const capH = caption ? Math.round(size * 0.16) : 0;
  canvas.width = size;
  canvas.height = size + capH;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const off = quiet * cell;
  const inEye = (r, c) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
  const badgeSize = badge ? Math.ceil(n * 0.22) | 1 : 0;
  const b0 = Math.floor((n - badgeSize) / 2);
  const inBadge = (r, c) => badge && r >= b0 - 1 && r < b0 + badgeSize + 1 && c >= b0 - 1 && c < b0 + badgeSize + 1;

  const dark = (r, c) => r >= 0 && c >= 0 && r < n && c < n && qr.isDark(r, c) && !inEye(r, c) && !inBadge(r, c);
  ctx.fillStyle = color;
  const R = cell * 0.5;
  const w = cell + 0.5; // a hair of overlap so joined modules have no seams
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!dark(r, c)) continue;
      const x = off + c * cell;
      const y = off + r * cell;
      const up = dark(r - 1, c), dn = dark(r + 1, c), lf = dark(r, c - 1), rt = dark(r, c + 1);
      const tl = !up && !lf ? R : 0, tr = !up && !rt ? R : 0, br = !dn && !rt ? R : 0, bl = !dn && !lf ? R : 0;
      ctx.beginPath();
      ctx.moveTo(x + tl, y);
      ctx.lineTo(x + w - tr, y);
      if (tr) ctx.arcTo(x + w, y, x + w, y + tr, tr); else ctx.lineTo(x + w, y);
      ctx.lineTo(x + w, y + w - br);
      if (br) ctx.arcTo(x + w, y + w, x + w - br, y + w, br); else ctx.lineTo(x + w, y + w);
      ctx.lineTo(x + bl, y + w);
      if (bl) ctx.arcTo(x, y + w, x, y + w - bl, bl); else ctx.lineTo(x, y + w);
      ctx.lineTo(x, y + tl);
      if (tl) ctx.arcTo(x, y, x + tl, y, tl); else ctx.lineTo(x, y);
      ctx.fill();
    }
  }

  const roundRect = (x, y, w, h, rad) => {
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  };
  // Finder "eyes": rounded ring + rounded centre.
  for (const [er, ec] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
    const x = off + ec * cell;
    const y = off + er * cell;
    ctx.fillStyle = color;
    roundRect(x, y, 7 * cell, 7 * cell, cell * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    roundRect(x + cell, y + cell, 5 * cell, 5 * cell, cell * 1.4);
    ctx.fill();
    ctx.fillStyle = color;
    roundRect(x + 2 * cell, y + 2 * cell, 3 * cell, 3 * cell, cell);
    ctx.fill();
  }

  if (badge) {
    const cx = off + (n / 2) * cell;
    const rad = (badgeSize * cell) / 2;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(cx, cx, rad + cell * 0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cx, rad, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 ${Math.round(rad * (initials.length > 1 ? 0.95 : 1.15))}px Inter, "Segoe UI", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(initials, cx, cx + rad * 0.06);
  }

  if (caption) {
    ctx.fillStyle = '#334155';
    ctx.font = `600 ${Math.round(capH * 0.36)}px Inter, "Segoe UI", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(caption, size / 2, size + capH * 0.38);
  }
}

function downloadShareQR() {
  if (!shareState) return;
  const built = buildQR(shareState.url);
  if (!built) return;
  const c = document.createElement('canvas');
  drawQR(c, built, 1200, shareAccent(), shareInitials(shareState.name), 'Scan to view my resume');
  c.toBlob(blob => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(shareState.name || 'My').replace(/[^\p{L}\p{N}]+/gu, '-')}-Resume-QR.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
    showToast('✅ QR code downloaded (high resolution, ready to print)', 'success');
  }, 'image/png');
}

// ── Sharing buttons ────────────────────────────────────
function shareTo(target) {
  if (!shareState) return;
  const url = shareState.url;
  const msg = `${shareState.name ? shareState.name + ' — ' : ''}my resume`;
  const enc = encodeURIComponent;
  const links = {
    whatsapp: `https://wa.me/?text=${enc(`${msg}: ${url}`)}`,
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${enc(url)}`,
    telegram: `https://t.me/share/url?url=${enc(url)}&text=${enc(msg)}`,
    email: `mailto:?subject=${enc(msg.charAt(0).toUpperCase() + msg.slice(1))}&body=${enc(`Hello,\n\nYou can view my resume here:\n${url}\n\nBest regards,\n${shareState.name || ''}`)}`
  };
  if (target === 'native') {
    navigator.share?.({ title: msg, text: msg, url }).catch(() => {});
    return;
  }
  if (target === 'email') { window.location.href = links.email; return; }
  window.open(links[target], '_blank', 'noopener,noreferrer');
}

function copyShareUrl() {
  const urlInput = document.getElementById('shareUrl');
  const text = urlInput.value;
  const done = () => {
    const btn = document.getElementById('shareCopyBtn');
    if (btn) {
      btn.innerHTML = '<i class="fas fa-check"></i> Copied';
      btn.classList.add('is-copied');
      setTimeout(() => { btn.innerHTML = '<i class="fas fa-copy"></i> Copy'; btn.classList.remove('is-copied'); }, 1800);
    }
    showToast('✅ Link copied to clipboard!', 'success');
  };
  const legacyCopy = () => {
    urlInput.select();
    urlInput.setSelectionRange(0, 99999);
    try { document.execCommand('copy'); done(); } catch (e) { showToast('❌ Could not copy — please copy the link manually', 'error'); }
  };
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done).catch(legacyCopy);
  else legacyCopy();
}

// ── Rendering the window ───────────────────────────────
function setShareView(state, message = '') {
  const views = { loading: 'shareLoading', ready: 'shareReady', error: 'shareError', stopped: 'shareStopped' };
  Object.entries(views).forEach(([k, id]) => { document.getElementById(id).hidden = k !== state; });
  if (state === 'error') document.getElementById('shareErrorText').textContent = message;
}

function renderShare() {
  const s = shareState;
  if (!s) return;
  setShareView('ready');
  document.getElementById('shareUrl').value = s.url;

  const canvas = document.getElementById('shareQrCanvas');
  const built = buildQR(s.url);
  const qrCard = document.getElementById('shareQrCard');
  qrCard.hidden = !built;
  document.getElementById('shareQrDownload').hidden = !built;
  if (built) drawQR(canvas, built, 640, shareAccent(), shareInitials(s.name));

  const live = s.mode === 'live';
  document.getElementById('shareLiveBox').hidden = !live;
  document.getElementById('sharePackedNote').hidden = live;
  document.getElementById('shareSub').textContent = live
    ? 'Your private link. It always shows the latest version of this resume.'
    : 'Anyone with this link can view your resume.';
  if (live) {
    document.getElementById('shareViews').textContent = `${s.views} view${s.views === 1 ? '' : 's'}`;
    document.getElementById('shareHideContact').checked = s.hideContact;
  } else {
    document.getElementById('sharePackedNote').innerHTML =
      `<i class="fas fa-circle-info"></i> <span><strong>Sign in</strong> for a short private link that updates when you edit, counts views and can be turned off.${s.hadPhoto ? ' Your photo isn\'t included in this link.' : ''}${built ? '' : ' This link is too long for a QR code.'}</span>`;
  }
  document.getElementById('shareNativeBtn').hidden = !navigator.share;
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
