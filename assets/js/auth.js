// ======================================================
// Auth + Cloud Save Module (Supabase)
// Handles sign up / sign in / sign out, and saving, listing, loading
// and deleting resumes tied to the logged-in user's account.
// Depends on: supabaseClient (supabase-config.js), and collectFormData(),
// restoreFromData(), escapeHTML(), showToast() from app.js.
// ======================================================

'use strict';

// Which cloud resume row auto-sync writes into. Persisted per-browser so a
// page reload keeps updating the same row instead of creating a new one
// every time; cleared on sign out so a different account on the same
// browser doesn't accidentally write into someone else's row.
const ACTIVE_CLOUD_ID_KEY = 'tr_active_cloud_resume_id';

let currentUser = null;
let currentCloudResumeId = null; // the cloud row currently loaded/being edited, if any
let currentCloudResumeName = null; // display name of that row, shown in the navbar badge
// Guards the one-time "pull my saved resume back in" pass below so a page
// refresh while already signed in restores the form from the cloud exactly
// once — not on every subsequent updateAuthUI() call during the session.
let initialCloudLoadDone = false;

// Bumped every time the user switches which resume is active (loading a
// different saved resume, or starting a new one). A save that started
// against the OLD resume captures the version at that moment; if it's
// still in flight when the version changes, it must not be allowed to
// touch currentCloudResumeId or the on-screen form when it finally
// resolves — otherwise a slow "create my first save" for resume A can
// complete AFTER the user has already switched to resume B and silently
// re-point the app at A's newly created row (or worse, get treated as
// B's row), which is how one resume's data ends up saved into another's.
let resumeContextVersion = 0;

function setActiveCloudResumeId(id) {
  currentCloudResumeId = id;
  try {
    if (id) localStorage.setItem(ACTIVE_CLOUD_ID_KEY, id);
    else localStorage.removeItem(ACTIVE_CLOUD_ID_KEY);
  } catch (e) { /* localStorage unavailable — auto-sync still works this tab */ }
}

// Shows which saved resume is currently loaded, right next to the logo, so
// switching between several saved resumes doesn't leave the user guessing
// which one is open. Hidden entirely when nothing is loaded (e.g. a brand
// new, not-yet-saved resume, or signed out).
function setActiveCloudResumeName(name) {
  currentCloudResumeName = name;
  const label = document.getElementById('activeResumeLabel');
  const textEl = document.getElementById('activeResumeLabelText');
  if (!label || !textEl) return;
  if (name) {
    textEl.textContent = name;
    label.style.display = 'flex';
  } else {
    label.style.display = 'none';
  }
}

// ── AUTH STATE ──────────────────────────────────────────
supabaseClient.auth.onAuthStateChange((_event, session) => {
  currentUser = session?.user || null;
  updateAuthUI();
});

async function initAuth() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  currentUser = session?.user || null;
  updateAuthUI();
}

function updateAuthUI() {
  const signedOut = document.getElementById('authSignedOut');
  const signedIn = document.getElementById('authSignedIn');
  const emailLabel = document.getElementById('authUserEmail');
  if (!signedOut || !signedIn) return;
  // The AI Tools badge depends on whether the site's free AI is available.
  if (typeof updateApiKeyStatus === 'function') updateApiKeyStatus();

  if (currentUser) {
    signedOut.style.display = 'none';
    signedIn.style.display = 'flex';
    const displayName = currentUser.user_metadata?.full_name;
    if (emailLabel) {
      emailLabel.textContent = displayName || currentUser.email;
      emailLabel.title = currentUser.email;
    }
    updateNavAvatar();

    let savedId = null;
    try { savedId = localStorage.getItem(ACTIVE_CLOUD_ID_KEY); } catch (e) {}
    currentCloudResumeId = savedId || null;
    const willLoad = currentCloudResumeId && !initialCloudLoadDone;
    // This also runs on every token refresh, so only set a starting status
    // once; after that the real save/load results own the badge.
    if (!syncState) setCloudSyncStatus(willLoad ? 'loading' : (currentCloudResumeId ? 'synced' : 'idle'));

    if (willLoad) {
      // A page load (or refresh) while already signed in — pull the
      // account's own saved resume back into the form. Local-storage
      // persistence was removed on purpose (it used to leak whatever was
      // on screen to the next visitor), so this cloud pull is now the
      // only thing that survives a refresh, and it only ever loads data
      // that belongs to the signed-in account.
      initialCloudLoadDone = true;
      loadCloudResume(currentCloudResumeId, { silent: true });
    } else if (!currentCloudResumeId) {
      // Covers the very first sign-in on this browser: nothing has synced yet,
      // so push whatever is currently on screen up right away instead of
      // waiting for the next edit.
      autoSyncToCloud();
    }
  } else {
    signedOut.style.display = 'flex';
    signedIn.style.display = 'none';
    setCloudSyncStatus(null);
  }
}

// ── AUTO-SYNC ───────────────────────────────────────────
// Piggybacks on the same debounced point app.js already uses to trigger a
// re-render (see generateCV() -> renderCV()), so any edit that redraws the
// preview also pushes to the cloud when signed in.
let autoSyncTimer = null;
let syncState = null;        // what the navbar badge currently says
let lastSyncedJSON = null;   // the form exactly as last saved to / loaded from the cloud
let lastSyncedAt = null;     // when that happened (for the badge tooltip)
let syncRetryTimer = null;
let syncRetryCount = 0;
const SYNC_RETRY_DELAYS_MS = [5000, 15000, 30000, 60000];

function formSnapshot() {
  try { return JSON.stringify(collectFormData()); } catch (e) { return null; }
}

function autoSyncToCloud() {
  if (!currentUser) return;
  // The saved copy of this resume never loaded, so the form on screen is
  // not that resume: saving it would overwrite the real one.
  if (syncState === 'loadfail') return;
  clearTimeout(autoSyncTimer);
  autoSyncTimer = null;
  // Nothing actually changed since the last save/load (e.g. the re-render
  // right after loading a resume, or undo back to the saved state).
  const snap = formSnapshot();
  if (snap && snap === lastSyncedJSON) {
    if (syncState === 'pending') setCloudSyncStatus('synced');
    return;
  }
  setCloudSyncStatus(navigator.onLine === false ? 'offline' : 'pending');
  autoSyncTimer = setTimeout(silentSaveToCloud, 1200);
}

function scheduleSyncRetry() {
  clearTimeout(syncRetryTimer);
  // Offline: the 'online' listener below retries as soon as we're back.
  if (navigator.onLine === false) return;
  const delay = SYNC_RETRY_DELAYS_MS[Math.min(syncRetryCount, SYNC_RETRY_DELAYS_MS.length - 1)];
  syncRetryCount++;
  syncRetryTimer = setTimeout(silentSaveToCloud, delay);
}

function retrySyncNow() {
  if (!currentUser) return;
  clearTimeout(syncRetryTimer);
  clearTimeout(autoSyncTimer);
  autoSyncTimer = null;
  silentSaveToCloud();
}

async function silentSaveToCloud() {
  autoSyncTimer = null;
  clearTimeout(syncRetryTimer);
  if (!currentUser || syncState === 'loadfail') return;

  // Lock in which resume this save is FOR, before anything async happens.
  const myVersion = resumeContextVersion;
  const startId = currentCloudResumeId;

  const data = collectFormData();
  const snap = formSnapshot();
  const hasData = data.personal.firstname || data.personal.lastname || data.personal.designation;
  if (!hasData) { // nothing worth syncing yet
    if (syncState === 'pending' || syncState === 'offline') setCloudSyncStatus(startId ? 'synced' : 'idle');
    return;
  }

  setCloudSyncStatus('syncing');

  try {
    if (startId) {
      // Never touch `name` here — the user may have given this resume a
      // custom name via the Rename option, and an autosave must not
      // silently overwrite that back to a name derived from the form.
      const { error } = await supabaseClient
        .from('resumes')
        .update({ data, updated_at: new Date().toISOString() })
        .eq('id', startId);
      if (error) throw error;
    } else {
      const name = [data.personal.firstname, data.personal.lastname].filter(Boolean).join(' ') || 'Untitled Resume';
      const { data: inserted, error } = await supabaseClient
        .from('resumes')
        .insert({ user_id: currentUser.id, name, data })
        .select()
        .single();
      if (error) throw error;
      // Only adopt the freshly created row as "active" if the user hasn't
      // already switched to a different resume while this insert was in
      // flight — otherwise we'd yank the app back onto this row (or, once
      // that other resume's own save fires, have it write into this row
      // by mistake).
      if (myVersion === resumeContextVersion) {
        setActiveCloudResumeId(inserted.id);
        setActiveCloudResumeName(inserted.name || name);
      }
    }
    if (myVersion !== resumeContextVersion) return;
    markSynced(snap);
  } catch (err) {
    if (myVersion !== resumeContextVersion) return;
    setCloudSyncStatus(navigator.onLine === false ? 'offline' : 'error', err.message);
    scheduleSyncRetry();
  }
}

// Called after a successful save or load. If the user kept typing while
// the request was in flight, a newer save is already queued, so the badge
// stays on "Unsaved changes" instead of claiming everything is synced.
function markSynced(snap) {
  lastSyncedJSON = snap;
  lastSyncedAt = Date.now();
  syncRetryCount = 0;
  if (autoSyncTimer) setCloudSyncStatus('pending');
  else if (snap && formSnapshot() !== snap) autoSyncToCloud();
  else setCloudSyncStatus('synced');
}

function timeAgo(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return s + ' sec ago';
  const m = Math.round(s / 60);
  if (m < 60) return m + ' min ago';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function hasUnsyncedChanges() {
  return !!currentUser && (!!autoSyncTimer || ['pending', 'syncing', 'error', 'offline'].includes(syncState));
}

// Back online: push whatever is waiting right away.
window.addEventListener('online', () => {
  if (currentUser && ['pending', 'error', 'offline'].includes(syncState)) retrySyncNow();
});
window.addEventListener('offline', () => {
  if (['pending', 'syncing', 'error'].includes(syncState)) setCloudSyncStatus('offline');
});
// Switching tabs or minimising: don't wait out the debounce, save now.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && autoSyncTimer) retrySyncNow();
});
// Closing or reloading with edits not yet in the cloud: start the save and
// let the browser ask "Leave site?" so the request has time to finish.
window.addEventListener('beforeunload', (e) => {
  if (!hasUnsyncedChanges()) return;
  if (autoSyncTimer) retrySyncNow();
  e.preventDefault();
  e.returnValue = '';
});

function setCloudSyncStatus(state, errorMessage) {
  const el = document.getElementById('cloudSyncStatus');
  syncState = state || null;
  if (!el) return;

  const views = {
    loading: ['fas fa-spinner fa-spin', 'Loading...', '', 'Loading your resume from the cloud'],
    pending: ['fas fa-pen', 'Unsaved changes', 'pending', 'Your latest edits will be saved in a moment'],
    syncing: ['fas fa-cloud-upload-alt fa-spin', 'Syncing...', '', 'Saving to the cloud'],
    synced: ['fas fa-check-circle', 'Synced', '', ''],
    offline: ['fas fa-wifi', 'Offline', 'pending', 'You are offline. Your edits will sync as soon as the connection is back.'],
    error: ['fas fa-exclamation-triangle', 'Sync failed · Retry', 'error', ''],
    loadfail: ['fas fa-exclamation-triangle', 'Load failed · Retry', 'error', ''],
    idle: ['fas fa-cloud', 'Not synced yet', 'idle', 'Start typing and your resume will be saved to your account']
  };
  const v = views[state];
  el.onclick = null;
  el.removeAttribute('role');
  el.removeAttribute('tabindex');
  if (!v) { el.textContent = ''; el.title = ''; el.className = 'cloud-sync-status'; return; }

  el.innerHTML = `<i class="${v[0]}"></i> <span>${v[1]}</span>`;
  el.className = 'cloud-sync-status' + (v[2] ? ' cloud-sync-status-' + v[2] : '');
  el.title = v[3];
  if (state === 'error') {
    el.title = 'Could not save' + (errorMessage ? ': ' + errorMessage : '') + '. Retrying automatically. Click to retry now.';
    el.onclick = retrySyncNow;
  } else if (state === 'loadfail') {
    el.title = 'Could not load your resume' + (errorMessage ? ': ' + errorMessage : '') + '. Click to try again.';
    el.onclick = retryLoadNow;
  }
  if (el.onclick) {
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
  }
}

let loadFailedId = null;
function retryLoadNow() {
  if (currentUser && loadFailedId) loadCloudResume(loadFailedId, { silent: true });
}

// The "Synced" tooltip says how long ago, worked out when it's hovered so
// it never goes stale.
document.addEventListener('mouseover', (e) => {
  const el = e.target.closest && e.target.closest('#cloudSyncStatus');
  if (el && syncState === 'synced' && lastSyncedAt) el.title = 'All changes saved · last synced ' + timeAgo(lastSyncedAt);
});
document.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.id === 'cloudSyncStatus' && e.target.onclick) {
    e.preventDefault();
    e.target.onclick();
  }
});

// ── SIGN UP / SIGN IN / SIGN OUT ───────────────────────
// New sign-up flow: email → 6-digit code (OTP) → set password → forced
// re-login. Avoids the old signUp()+confirmation-link flow entirely, since
// clicking the link from the email client was breaking for the user.
async function authSendSignupCode(email) {
  const { data, error } = await supabaseClient.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true }
  });
  if (error) throw error;
  return data;
}

async function authVerifySignupCode(email, code) {
  const { data, error } = await supabaseClient.auth.verifyOtp({
    email,
    token: code,
    type: 'email'
  });
  if (error) throw error;
  return data; // on success this also creates a live session
}

async function authSignIn(email, password) {
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

// scope 'global' also ends the sessions on every other device.
async function authSignOut({ scope = 'local', removeKey = false } = {}) {
  const { error } = await supabaseClient.auth.signOut({ scope });
  if (error && scope === 'global') throw error;
  setActiveCloudResumeId(null);
  if (removeKey) {
    try { localStorage.removeItem('geminiApiKey'); } catch (e) {}
  }
  showToast(scope === 'global' ? '✅ Signed out on all devices' : '✅ Signed out', 'success');

  // Reload rather than just flipping the nav UI: this is the one place
  // that guarantees every trace of the account's resume — form fields,
  // the live preview, in-memory state like currentTemplate —
  // is actually wiped, so the next person on this browser starts from a
  // genuinely blank form instead of still seeing this account's data.
  setTimeout(() => window.location.reload(), 500);
}

// ── SIGN-OUT DIALOG ─────────────────────────────────────
// Saves anything not yet in the cloud first, so signing out right after
// typing never loses the last edits, and offers to forget the Gemini key
// (it lives in the browser, not the account).
function openSignOutDialog() {
  closeAccountMenu();
  const modal = document.getElementById('signOutModal');
  const keyRow = document.getElementById('signOutKeyRow');
  const status = document.getElementById('signOutStatus');
  const btn = document.getElementById('signOutConfirmBtn');
  let hasKey = false;
  try { hasKey = !!localStorage.getItem('geminiApiKey'); } catch (e) {}
  keyRow.hidden = !hasKey;
  document.getElementById('signOutRemoveKey').checked = false;
  status.className = 'hint-text';
  status.textContent = hasUnsyncedChanges()
    ? 'Your latest changes will be saved first.'
    : 'Your resume is saved to your account. You can sign in again any time.';
  document.getElementById('signOutTitle').innerHTML = '<i class="fas fa-arrow-right-from-bracket"></i> Sign out?';
  btn.disabled = false;
  btn.innerHTML = '<i class="fas fa-arrow-right-from-bracket"></i> Sign out';
  btn.dataset.force = '';
  btn.onclick = () => confirmSignOut('local');
  modal.style.display = 'flex';
  btn.focus();
}

function closeSignOutDialog() {
  document.getElementById('signOutModal').style.display = 'none';
}

async function confirmSignOut(scope = 'local') {
  const status = document.getElementById('signOutStatus');
  const btn = document.getElementById('signOutConfirmBtn');
  const removeKey = document.getElementById('signOutRemoveKey').checked;
  const force = btn.dataset.force === '1';

  if (!force && hasUnsyncedChanges()) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving your changes...';
    clearTimeout(autoSyncTimer);
    autoSyncTimer = null;
    await silentSaveToCloud();
    if (hasUnsyncedChanges()) {
      // Couldn't save (offline?). Say so and let the user decide.
      status.className = 'field-error-msg';
      status.textContent = '⚠️ Your latest changes could not be saved (are you offline?). If you sign out now they will be lost.';
      btn.disabled = false;
      btn.dataset.force = '1';
      btn.innerHTML = '<i class="fas fa-arrow-right-from-bracket"></i> Sign out anyway';
      return;
    }
  }

  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Signing out...';
  try {
    await authSignOut({ scope, removeKey });
  } catch (err) {
    status.className = 'field-error-msg';
    status.textContent = '❌ ' + (err.message || 'Could not sign out');
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-arrow-right-from-bracket"></i> Sign out';
  }
}

function signOutEverywhere() {
  closeAccountModal();
  openSignOutDialog();
  document.getElementById('signOutTitle').innerHTML = '<i class="fas fa-laptop"></i> Sign out of all devices?';
  document.getElementById('signOutStatus').textContent = 'You will be signed out here and on every other phone or computer where you are signed in.';
  const btn = document.getElementById('signOutConfirmBtn');
  btn.onclick = () => confirmSignOut('global');
  btn.innerHTML = '<i class="fas fa-arrow-right-from-bracket"></i> Sign out everywhere';
}

// ── NAV AVATAR + ACCOUNT MENU ───────────────────────────
function avatarHTML(url) {
  return url && /^https:\/\//i.test(url)
    ? `<img src="${escapeHTML(url)}" alt="">`
    : '<i class="fas fa-user"></i>';
}

function updateNavAvatar() {
  const url = currentUser?.user_metadata?.avatar_url;
  ['authUserAvatar', 'accountMenuAvatar'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = avatarHTML(url);
  });
  const name = currentUser?.user_metadata?.full_name || '';
  const nameEl = document.getElementById('accountMenuName');
  const mailEl = document.getElementById('accountMenuEmail');
  if (nameEl) nameEl.textContent = name || 'Your account';
  if (mailEl) mailEl.textContent = currentUser?.email || '';
}

function updateAccountMenuTheme() {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark' ||
    (!document.documentElement.getAttribute('data-theme') && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  const label = document.getElementById('accountMenuThemeLabel');
  const icon = document.getElementById('accountMenuThemeIcon');
  if (label) label.textContent = dark ? 'Light mode' : 'Dark mode';
  if (icon) icon.className = dark ? 'fas fa-sun' : 'fas fa-moon';
}

function toggleAccountMenu() {
  const panel = document.getElementById('accountMenuPanel');
  if (panel.hidden) openAccountMenu(); else closeAccountMenu();
}

function openAccountMenu() {
  const panel = document.getElementById('accountMenuPanel');
  const btn = document.getElementById('accountMenuBtn');
  updateNavAvatar();
  updateAccountMenuTheme();
  const meta = document.getElementById('accountMenuAi');
  if (meta) meta.textContent = siteAIUsageText();
  panel.hidden = false;
  btn.setAttribute('aria-expanded', 'true');
  panel.querySelector('[role="menuitem"]')?.focus();
  refreshAIUsage().then(() => { if (meta) meta.textContent = siteAIUsageText(); });
}

function closeAccountMenu() {
  const panel = document.getElementById('accountMenuPanel');
  const btn = document.getElementById('accountMenuBtn');
  if (!panel || panel.hidden) return;
  panel.hidden = true;
  btn?.setAttribute('aria-expanded', 'false');
}

// Click outside or Escape closes the menu; arrow keys move between items.
document.addEventListener('click', (e) => {
  if (!e.target.closest?.('#accountMenu')) closeAccountMenu();
});
document.addEventListener('keydown', (e) => {
  const panel = document.getElementById('accountMenuPanel');
  if (!panel || panel.hidden) return;
  if (e.key === 'Escape') { closeAccountMenu(); document.getElementById('accountMenuBtn')?.focus(); return; }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const items = [...panel.querySelectorAll('[role="menuitem"]')];
    const i = items.indexOf(document.activeElement);
    const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
    items[next].focus();
  }
});

// ── AI USAGE (shared key) ───────────────────────────────
let aiUsageInfo = { used: null, limit: null, enabled: null };

async function refreshAIUsage() {
  if (!currentUser) return aiUsageInfo;
  try {
    const [usage, cfg] = await Promise.all([
      supabaseClient.rpc('get_ai_usage'),
      aiUsageInfo.limit === null
        ? fetch('/api/gemini', { method: 'GET' }).then(r => (r.ok ? r.json() : null)).catch(() => null)
        : Promise.resolve(null)
    ]);
    if (!usage.error && typeof usage.data === 'number') aiUsageInfo.used = usage.data;
    if (cfg) { aiUsageInfo.limit = cfg.limit; aiUsageInfo.enabled = cfg.enabled; }
  } catch (e) { /* keep what we had */ }
  // A request made since then is more up to date.
  if (typeof siteAIUsage !== 'undefined' && siteAIUsage && (aiUsageInfo.used === null || siteAIUsage.used > aiUsageInfo.used)) {
    aiUsageInfo.used = siteAIUsage.used;
    aiUsageInfo.limit = siteAIUsage.limit;
  }
  return aiUsageInfo;
}

function siteAIUsageText() {
  const { used, limit } = aiUsageInfo;
  if (used === null || !limit) return '';
  return `${Math.min(used, limit)}/${limit}`;
}

// ── ACCOUNT SETTINGS MODAL ──────────────────────────────
// Lets a signed-in user update their display name, phone number, and
// profile picture (stored in Supabase's per-user metadata — no extra
// database table needed), plus change their password. All writes go
// through supabaseClient.auth.updateUser, which only ever touches the
// currently-authenticated user's own account.
let pendingAvatarFile = null;

function openAccountModal(tab = 'profile') {
  if (!currentUser) return;
  closeAccountMenu();
  pendingAvatarFile = null;
  document.getElementById('accountEmail').textContent = currentUser.email;
  document.getElementById('accountFullName').value = currentUser.user_metadata?.full_name || '';
  document.getElementById('accountPhone').value = currentUser.user_metadata?.phone || '';
  ['accountCurrentPassword', 'accountNewPassword', 'accountConfirmPassword', 'deleteAccountPassword', 'deleteAccountConfirm']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  updatePasswordStrength();
  document.getElementById('accountAvatarPreview').innerHTML = avatarHTML(currentUser.user_metadata?.avatar_url);

  const fmt = (iso) => iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—';
  document.getElementById('accountFactEmail').textContent =
    currentUser.email + (currentUser.email_confirmed_at ? ' ✓ verified' : '');
  document.getElementById('accountFactCreated').textContent = fmt(currentUser.created_at);
  document.getElementById('accountFactLastSignIn').textContent = fmt(currentUser.last_sign_in_at);

  hideAccountMessages();
  document.getElementById('accountModal').style.display = 'flex';
  showAccountTab(tab);
}

function showAccountTab(tab) {
  document.querySelectorAll('#accountModal .account-tabs [role="tab"]').forEach(t => {
    const on = t.dataset.tab === tab;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
  });
  document.querySelectorAll('#accountModal .account-panel').forEach(p => {
    p.hidden = p.id !== `accPanel-${tab}`;
  });
  if (tab === 'ai') renderAccountAI();
}

// Arrow keys move between tabs, like a native tab strip.
document.addEventListener('keydown', (e) => {
  if (!e.target.closest?.('#accountModal .account-tabs')) return;
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
  const tabs = [...document.querySelectorAll('#accountModal .account-tabs [role="tab"]')];
  const i = tabs.indexOf(e.target);
  const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
  showAccountTab(next.dataset.tab);
  next.focus();
});

async function renderAccountAI() {
  const count = document.getElementById('accountAiCount');
  const bar = document.getElementById('accountAiBar');
  const note = document.getElementById('accountAiNote');
  const keyState = document.getElementById('accountAiKeyState');
  let ownKey = false;
  try { ownKey = !!localStorage.getItem('geminiApiKey'); } catch (e) {}
  keyState.textContent = ownKey
    ? '✓ Your own key is saved in this browser, so AI here uses it, with no daily limit.'
    : 'Not set. AI uses the site\'s free key. Add your own free key in AI Tools for unlimited use.';

  count.textContent = '…';
  const { used, limit, enabled } = await refreshAIUsage();
  if (enabled === false) {
    count.textContent = 'Off';
    bar.style.width = '0';
    note.textContent = 'The site\'s free AI is not switched on. Add your own key to use the AI tools.';
    return;
  }
  if (used === null || !limit) {
    count.textContent = '—';
    bar.style.width = '0';
    note.textContent = 'Could not load your usage right now.';
    return;
  }
  const shown = Math.min(used, limit);
  count.textContent = `${shown} / ${limit}`;
  bar.style.width = `${Math.round((shown / limit) * 100)}%`;
  bar.dataset.level = shown >= limit ? 'full' : shown / limit >= 0.8 ? 'high' : '';
  note.textContent = shown >= limit
    ? 'You have used all of today\'s free requests. They reset at midnight (UTC).'
    : `${limit - shown} left today. Resets at midnight (UTC).`;
}

// Shows or hides a password field's text.
function togglePasswordVisibility(id, btn) {
  const input = document.getElementById(id);
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  btn.innerHTML = `<i class="fas fa-eye${show ? '-slash' : ''}"></i>`;
  btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
}

// 0–4 score from length and character variety, with common weak patterns
// pulled down. Simple on purpose: it guides, the server decides.
function passwordScore(pw) {
  if (!pw) return -1;
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (/^(password|qwerty|123456|111111|abc123|letmein)/i.test(pw) || /(.)\1{3,}/.test(pw)) score = Math.min(score, 1);
  if (pw.length < 8) score = Math.min(score, 1);
  return Math.min(4, score);
}

function updatePasswordStrength() {
  const input = document.getElementById('accountNewPassword');
  const bar = document.getElementById('passwordMeterBar');
  const text = document.getElementById('passwordMeterText');
  if (!input || !bar || !text) return;
  const s = passwordScore(input.value);
  const labels = ['Too weak', 'Weak', 'Fair', 'Good', 'Strong'];
  bar.style.width = s < 0 ? '0' : `${(s + 1) * 20}%`;
  bar.dataset.level = s < 0 ? '' : String(s);
  text.textContent = s < 0 ? '' : `${labels[s]}${s < 3 ? ' · use 12+ characters with upper and lower case, numbers and symbols' : ''}`;
}

// Copies name, email and phone from the account into the resume's empty
// Personal Info fields.
function fillResumeFromProfile() {
  const meta = currentUser?.user_metadata || {};
  const parts = (meta.full_name || '').trim().split(/\s+/).filter(Boolean);
  const values = {
    firstname: parts[0] || '',
    lastname: parts.length > 1 ? parts.slice(1).join(' ') : '',
    email: currentUser?.email || '',
    phoneno: meta.phone || ''
  };
  const filled = [];
  for (const [cls, val] of Object.entries(values)) {
    const el = document.querySelector('.' + cls);
    if (el && val && !el.value.trim()) { el.value = val; filled.push(cls === 'phoneno' ? 'phone' : cls.replace('name', ' name')); }
  }
  if (filled.length) {
    generateCV();
    showToast(`✅ Filled ${filled.join(', ')}`, 'success');
  } else {
    showToast('Nothing to fill: those fields already have values, or your profile is empty', 'info');
  }
}

// GDPR "right of access": one JSON file with the profile and every resume.
async function downloadMyData() {
  const btn = document.getElementById('accountExportBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Preparing...';
  try {
    const { data: resumes, error } = await supabaseClient
      .from('resumes')
      .select('id, name, data, updated_at')
      .order('updated_at', { ascending: false });
    if (error) throw error;
    const meta = currentUser.user_metadata || {};
    const exportData = {
      exportedAt: new Date().toISOString(),
      exportedFrom: 'Taimur Resume (taimur-resume.vercel.app)',
      account: {
        email: currentUser.email,
        fullName: meta.full_name || '',
        phone: meta.phone || '',
        avatarUrl: meta.avatar_url || '',
        createdAt: currentUser.created_at,
        lastSignInAt: currentUser.last_sign_in_at
      },
      resumes: resumes || []
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `taimur-resume-my-data-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    showToast(`✅ Downloaded your data (${(resumes || []).length} resume${(resumes || []).length === 1 ? '' : 's'})`, 'success');
  } catch (err) {
    showToast('❌ Could not download your data: ' + (err.message || err), 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-download"></i> Download my data';
  }
}

// GDPR "right to erasure". Asks for the password and a typed DELETE first,
// removes the profile photo, then deletes the account and all its rows in
// one database call (supabase/account.sql).
async function deleteMyAccount() {
  const errorEl = document.getElementById('deleteAccountError');
  const btn = document.getElementById('deleteAccountBtn');
  const password = document.getElementById('deleteAccountPassword').value;
  const typed = document.getElementById('deleteAccountConfirm').value.trim();
  const fail = (msg) => { errorEl.textContent = msg; errorEl.style.display = 'block'; };
  errorEl.style.display = 'none';

  if (!password) return fail('Enter your password to confirm it\'s you.');
  if (typed !== 'DELETE') return fail('Type DELETE (in capital letters) to confirm.');

  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Deleting...';
  try {
    const { error: authError } = await supabaseClient.auth.signInWithPassword({ email: currentUser.email, password });
    if (authError) throw new Error('That password is not correct.');

    // Make sure the server side is set up (same SQL file) before touching
    // anything, so a missing setup can't leave a half-deleted account.
    const check = await supabaseClient.rpc('get_ai_usage');
    if (check.error) {
      throw new Error('Account deletion is not set up on the server yet (supabase/account.sql). Nothing was deleted.');
    }

    // Stop autosave from re-creating a resume while we delete.
    clearTimeout(autoSyncTimer);
    autoSyncTimer = null;
    resumeContextVersion++;

    // Profile photo: best effort, the account goes either way.
    try {
      const { data: files } = await supabaseClient.storage.from('avatars').list(currentUser.id);
      if (files?.length) await supabaseClient.storage.from('avatars').remove(files.map(f => `${currentUser.id}/${f.name}`));
    } catch (e) { /* ignore */ }

    const { error } = await supabaseClient.rpc('delete_my_account');
    if (error) {
      throw new Error(/function|not find|schema cache/i.test(error.message)
        ? 'Account deletion is not set up on the server yet (supabase/account.sql). Nothing was deleted.'
        : error.message);
    }

    try {
      localStorage.removeItem(ACTIVE_CLOUD_ID_KEY);
      localStorage.removeItem('geminiApiKey');
    } catch (e) {}
    await supabaseClient.auth.signOut({ scope: 'local' }).catch(() => {});
    currentUser = null;
    showToast('✅ Your account and all your data have been deleted', 'success');
    setTimeout(() => { window.location.href = 'index.html'; }, 1500);
  } catch (err) {
    fail('❌ ' + (err.message || 'Could not delete the account'));
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-trash-can"></i> Delete my account permanently';
  }
}

function closeAccountModal() {
  document.getElementById('accountModal').style.display = 'none';
}

function hideAccountMessages() {
  ['accountProfileError', 'accountProfileSuccess', 'accountPasswordError', 'accountPasswordSuccess'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
}

function previewAccountAvatar(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    showToast('❌ Please choose an image file', 'error');
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    showToast('❌ Image must be under 2MB', 'error');
    return;
  }
  pendingAvatarFile = file;
  const reader = new FileReader();
  reader.onload = (e) => {
    document.getElementById('accountAvatarPreview').innerHTML = `<img src="${e.target.result}" alt="Avatar">`;
  };
  reader.readAsDataURL(file);
}

async function uploadPendingAvatar() {
  if (!pendingAvatarFile) return currentUser.user_metadata?.avatar_url || null;
  const ext = (pendingAvatarFile.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const path = `${currentUser.id}/avatar.${ext}`;
  const { error: uploadError } = await supabaseClient.storage
    .from('avatars')
    .upload(path, pendingAvatarFile, { upsert: true, cacheControl: '3600' });
  if (uploadError) throw uploadError;
  const { data } = supabaseClient.storage.from('avatars').getPublicUrl(path);
  // Cache-bust so the new picture shows immediately even though the path
  // (and therefore URL) stays the same across re-uploads.
  return `${data.publicUrl}?t=${Date.now()}`;
}

async function saveAccountProfile(event) {
  event.preventDefault();
  hideAccountMessages();
  const errorEl = document.getElementById('accountProfileError');
  const successEl = document.getElementById('accountProfileSuccess');
  const btn = document.getElementById('accountProfileSaveBtn');
  const fullName = document.getElementById('accountFullName').value.trim();
  const phone = document.getElementById('accountPhone').value.trim();

  btn.disabled = true;
  btn.textContent = 'Saving...';
  try {
    const avatarUrl = await uploadPendingAvatar();
    const { error } = await supabaseClient.auth.updateUser({
      data: { full_name: fullName, phone: phone, avatar_url: avatarUrl }
    });
    if (error) throw error;
    pendingAvatarFile = null;
    successEl.textContent = '✅ Profile updated';
    successEl.style.display = 'block';
    showToast('✅ Profile updated', 'success');
  } catch (err) {
    errorEl.textContent = err.message || 'Could not update profile';
    errorEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Profile';
  }
}

async function changeAccountPassword(event) {
  event.preventDefault();
  hideAccountMessages();
  const errorEl = document.getElementById('accountPasswordError');
  const successEl = document.getElementById('accountPasswordSuccess');
  const btn = document.getElementById('accountPasswordSaveBtn');
  const currentPassword = document.getElementById('accountCurrentPassword').value;
  const newPassword = document.getElementById('accountNewPassword').value;
  const confirmPassword = document.getElementById('accountConfirmPassword').value;
  const fail = (msg) => { errorEl.textContent = msg; errorEl.style.display = 'block'; };

  if (!currentPassword) return fail('Enter your current password');
  if (newPassword.length < 8) return fail('New password must be at least 8 characters');
  if (passwordScore(newPassword) < 2) return fail('That password is too easy to guess. Add more characters, numbers or symbols.');
  if (newPassword === currentPassword) return fail('The new password must be different from the current one');
  if (newPassword !== confirmPassword) return fail('New passwords do not match');

  btn.disabled = true;
  btn.textContent = 'Updating...';
  try {
    // Confirm it's really the account owner (e.g. not someone at an
    // unlocked computer) before changing the password.
    const { error: authError } = await supabaseClient.auth.signInWithPassword({ email: currentUser.email, password: currentPassword });
    if (authError) throw new Error('Your current password is not correct');
    const { error } = await supabaseClient.auth.updateUser({ password: newPassword });
    if (error) throw error;
    ['accountCurrentPassword', 'accountNewPassword', 'accountConfirmPassword'].forEach(id => { document.getElementById(id).value = ''; });
    updatePasswordStrength();
    successEl.textContent = '✅ Password updated';
    successEl.style.display = 'block';
    showToast('✅ Password updated', 'success');
  } catch (err) {
    errorEl.textContent = err.message || 'Could not update password';
    errorEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Update Password';
  }
}

// ── AUTH MODAL ──────────────────────────────────────────
// Multi-step flow:
//   signin  -> sign in with email + password (existing accounts)
//   signupEmail -> enter email only, sends a 6-digit code
//   signupCode  -> enter the code, verifies it (creates a temp session)
//   signupPassword -> set a password for the new account, then the user
//                     is signed out and sent back to signin to log in fresh
let authStep = 'signin'; // 'signin' | 'signupEmail' | 'signupCode' | 'signupPassword'
let pendingSignupEmail = '';
let resendCodeCooldownUntil = 0;

const AUTH_STEP_IDS = ['authStepSignin', 'authStepSignupEmail', 'authStepSignupCode', 'authStepSignupPassword'];

function showAuthStep(step) {
  authStep = step;
  const idMap = {
    signin: 'authStepSignin',
    signupEmail: 'authStepSignupEmail',
    signupCode: 'authStepSignupCode',
    signupPassword: 'authStepSignupPassword'
  };
  AUTH_STEP_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = (id === idMap[step]) ? 'block' : 'none';
  });
  // Hide any leftover error banners from other steps.
  ['signinError', 'signupEmailError', 'signupCodeError', 'signupPasswordError'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
}

function openAuthModal(mode = 'signin') {
  document.getElementById('authModal').style.display = 'flex';
  showAuthStep(mode === 'signup' ? 'signupEmail' : 'signin');
}

function closeAuthModal() {
  document.getElementById('authModal').style.display = 'none';
  ['authFormSignin', 'authFormSignupEmail', 'authFormSignupCode', 'authFormSignupPassword'].forEach(id => {
    const form = document.getElementById(id);
    if (form) form.reset();
  });
}

// Kept for the "Sign Up" / "Sign In" links inside the modal itself.
function switchAuthMode() {
  showAuthStep(authStep === 'signin' ? 'signupEmail' : 'signin');
}

// ── Step 1: Sign In (existing accounts) ─────────────────
async function handleSigninSubmit(event) {
  event.preventDefault();
  const email = document.getElementById('signinEmail').value.trim();
  const password = document.getElementById('signinPassword').value;
  const errorEl = document.getElementById('signinError');
  const submitBtn = document.getElementById('signinSubmitBtn');
  if (!email || !password) return;

  submitBtn.disabled = true;
  const originalText = submitBtn.textContent;
  submitBtn.textContent = 'Please wait...';
  errorEl.style.display = 'none';

  try {
    await authSignIn(email, password);
    showToast('✅ Signed in!', 'success');
    closeAuthModal();
  } catch (err) {
    errorEl.style.color = 'var(--danger)';
    errorEl.textContent = err.message || 'Something went wrong';
    errorEl.style.display = 'block';
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalText;
  }
}

// ── Step 2: Sign Up — email only, sends the code ────────
async function handleSignupEmailSubmit(event) {
  event.preventDefault();
  const email = document.getElementById('signupEmail').value.trim();
  const errorEl = document.getElementById('signupEmailError');
  const submitBtn = document.getElementById('signupEmailSubmitBtn');
  if (!email) return;

  submitBtn.disabled = true;
  const originalText = submitBtn.textContent;
  submitBtn.textContent = 'Sending...';
  errorEl.style.display = 'none';

  try {
    await authSendSignupCode(email);
    pendingSignupEmail = email;
    resendCodeCooldownUntil = Date.now() + 30000;
    document.getElementById('signupCodeEmailLabel').textContent = email;
    document.getElementById('signupCode').value = '';
    showAuthStep('signupCode');
  } catch (err) {
    errorEl.style.color = 'var(--danger)';
    errorEl.textContent = err.message || 'Could not send verification code';
    errorEl.style.display = 'block';
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalText;
  }
}

async function resendSignupCode() {
  const link = document.getElementById('resendCodeLink');
  if (Date.now() < resendCodeCooldownUntil) {
    showToast('Please wait a moment before requesting another code', 'error');
    return;
  }
  try {
    await authSendSignupCode(pendingSignupEmail);
    resendCodeCooldownUntil = Date.now() + 30000;
    showToast('✅ Code resent', 'success');
  } catch (err) {
    showToast('❌ ' + (err.message || 'Could not resend code'), 'error');
  }
}

// ── Step 3: Sign Up — verify the code ───────────────────
async function handleSignupCodeSubmit(event) {
  event.preventDefault();
  const code = document.getElementById('signupCode').value.trim();
  const errorEl = document.getElementById('signupCodeError');
  const submitBtn = document.getElementById('signupCodeSubmitBtn');
  if (!code) return;

  submitBtn.disabled = true;
  const originalText = submitBtn.textContent;
  submitBtn.textContent = 'Verifying...';
  errorEl.style.display = 'none';

  try {
    await authVerifySignupCode(pendingSignupEmail, code);
    document.getElementById('signupPassword').value = '';
    document.getElementById('signupPasswordConfirm').value = '';
    showAuthStep('signupPassword');
  } catch (err) {
    errorEl.style.color = 'var(--danger)';
    errorEl.textContent = err.message || 'Invalid or expired code';
    errorEl.style.display = 'block';
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalText;
  }
}

// ── Step 4: Sign Up — set password, then force a fresh login ─
async function handleSignupPasswordSubmit(event) {
  event.preventDefault();
  const password = document.getElementById('signupPassword').value;
  const confirmPassword = document.getElementById('signupPasswordConfirm').value;
  const errorEl = document.getElementById('signupPasswordError');
  const submitBtn = document.getElementById('signupPasswordSubmitBtn');

  if (password.length < 6) {
    errorEl.style.color = 'var(--danger)';
    errorEl.textContent = 'Password must be at least 6 characters';
    errorEl.style.display = 'block';
    return;
  }
  if (password !== confirmPassword) {
    errorEl.style.color = 'var(--danger)';
    errorEl.textContent = 'Passwords do not match';
    errorEl.style.display = 'block';
    return;
  }

  submitBtn.disabled = true;
  const originalText = submitBtn.textContent;
  submitBtn.textContent = 'Saving...';
  errorEl.style.display = 'none';

  try {
    const { error } = await supabaseClient.auth.updateUser({ password });
    if (error) throw error;

    // Verifying the code above created a temporary session — sign it out
    // so the user has to log in fresh with their new email + password,
    // exactly as requested, rather than silently continuing signed in.
    const emailForLogin = pendingSignupEmail;
    await supabaseClient.auth.signOut();
    setActiveCloudResumeId(null);
    pendingSignupEmail = '';

    try { sessionStorage.setItem('tr_just_signed_up_email', emailForLogin); } catch (e) {}
    window.location.hash = 'signin';
    window.location.reload();
  } catch (err) {
    errorEl.style.color = 'var(--danger)';
    errorEl.textContent = err.message || 'Something went wrong';
    errorEl.style.display = 'block';
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalText;
  }
}

// ── CLOUD SAVE / LOAD / DELETE ─────────────────────────
async function saveToCloud() {
  if (!currentUser) { openAuthModal('signin'); return; }
  if (syncState === 'loadfail') {
    showToast('⚠️ Your saved resume did not load yet. Click "Load failed · Retry" first so it is not overwritten.', 'error');
    return;
  }

  // Lock in which resume this save is FOR, before anything async happens —
  // see the comment on resumeContextVersion above.
  const myVersion = resumeContextVersion;
  const startId = currentCloudResumeId;

  // A manual save replaces any autosave still waiting, so the two can't
  // both create a new row for the same resume.
  clearTimeout(autoSyncTimer);
  autoSyncTimer = null;
  clearTimeout(syncRetryTimer);

  const data = collectFormData();
  const snap = formSnapshot();

  setCloudSyncStatus('syncing');
  try {
    if (startId) {
      // Never touch `name` here — preserve any custom name the user set
      // via Rename; only the resume content should change on save.
      const { error } = await supabaseClient
        .from('resumes')
        .update({ data, updated_at: new Date().toISOString() })
        .eq('id', startId);
      if (error) throw error;
      showToast('✅ Resume updated in cloud!', 'success');
    } else {
      const name = [data.personal.firstname, data.personal.lastname].filter(Boolean).join(' ') || 'Untitled Resume';
      const { data: inserted, error } = await supabaseClient
        .from('resumes')
        .insert({ user_id: currentUser.id, name, data })
        .select()
        .single();
      if (error) throw error;
      // Don't steal focus back onto this row if the user has already
      // switched to a different resume while the insert was in flight.
      if (myVersion === resumeContextVersion) {
        setActiveCloudResumeId(inserted.id);
        setActiveCloudResumeName(inserted.name);
      }
      showToast('✅ Resume saved to cloud!', 'success');
    }
    if (myVersion === resumeContextVersion) markSynced(snap);
  } catch (err) {
    setCloudSyncStatus(navigator.onLine === false ? 'offline' : 'error', err.message);
    scheduleSyncRetry();
    showToast('❌ Could not save: ' + err.message, 'error');
  }
}

async function openMyResumes() {
  if (!currentUser) { openAuthModal('signin'); return; }

  const modal = document.getElementById('myResumesModal');
  const listEl = document.getElementById('myResumesList');
  modal.style.display = 'flex';
  listEl.innerHTML = '<div class="ai-loading"><i class="fas fa-spinner fa-spin"></i><span>Loading...</span></div>';

  try {
    const { data: resumes, error } = await supabaseClient
      .from('resumes')
      .select('id, name, updated_at')
      .order('updated_at', { ascending: false });
    if (error) throw error;

    if (!resumes.length) {
      listEl.innerHTML = '<div class="empty-state"><i class="fas fa-cloud"></i><p>No saved resumes yet. Start typing your name in Personal Information and your resume will be saved here automatically.</p></div>';
      return;
    }

    // The resume that's open right now goes first, marked "Open now".
    resumes.sort((a, b) => (b.id === currentCloudResumeId) - (a.id === currentCloudResumeId));

    listEl.innerHTML = resumes.map(r => {
      const isCurrent = r.id === currentCloudResumeId;
      return `
      <div class="my-resume-item${isCurrent ? ' is-current' : ''}" data-id="${r.id}">
        <div class="my-resume-info">
          <strong><span class="my-resume-name">${escapeHTML(r.name || 'Untitled Resume')}</span>${isCurrent ? ' <em class="my-resume-current">Open now</em>' : ''}</strong>
          <span>Last saved ${new Date(r.updated_at).toLocaleString()}</span>
        </div>
        <div class="my-resume-actions">
          ${isCurrent
            ? `<button class="btn-icon" title="This resume is already open" disabled><i class="fas fa-folder-open"></i></button>`
            : `<button onclick="loadCloudResume('${r.id}')" class="btn-icon" title="Open this resume"><i class="fas fa-folder-open"></i></button>`}
          <button onclick="startRenameResume(this)" class="btn-icon" title="Rename"><i class="fas fa-pen"></i></button>
          <button onclick="duplicateCloudResume('${r.id}')" class="btn-icon" title="Duplicate"><i class="fas fa-clone"></i></button>
          <button onclick="deleteCloudResume('${r.id}')" class="remove-btn" title="Delete"><i class="fas fa-trash-alt"></i></button>
        </div>
      </div>`;
    }).join('');
  } catch (err) {
    listEl.innerHTML = `<div class="ai-error">❌ ${err.message}</div>`;
  }
}

// Swaps one list row's name into an editable text box in place — reads
// everything it needs (the row's id, current name) straight off the DOM
// via the clicked button, so there's no id/name to smuggle through an
// onclick string and no risk of a name containing a quote breaking the
// markup.
function startRenameResume(btn) {
  const item = btn.closest('.my-resume-item');
  if (!item) return;
  const nameEl = item.querySelector('.my-resume-name') || item.querySelector('.my-resume-info strong');
  const currentName = nameEl.textContent;

  const infoEl = item.querySelector('.my-resume-info');
  infoEl.innerHTML = `<input type="text" class="rename-input" value="${escapeHTML(currentName)}" maxlength="100">`;
  const input = infoEl.querySelector('.rename-input');
  input.focus();
  input.select();

  const actionsEl = item.querySelector('.my-resume-actions');
  actionsEl.innerHTML = `
    <button onclick="confirmRenameResume(this)" class="btn-icon" title="Save name"><i class="fas fa-check"></i></button>
    <button onclick="openMyResumes()" class="btn-icon" title="Cancel"><i class="fas fa-times"></i></button>
  `;

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); actionsEl.querySelector('.btn-icon').click(); }
    if (e.key === 'Escape') openMyResumes();
  });
}

async function confirmRenameResume(btn) {
  const item = btn.closest('.my-resume-item');
  if (!item) return;
  const id = item.dataset.id;
  const input = item.querySelector('.rename-input');
  const newName = (input?.value || '').trim() || 'Untitled Resume';

  try {
    const { error } = await supabaseClient.from('resumes').update({ name: newName }).eq('id', id);
    if (error) throw error;
    // Keep the navbar badge in sync if this is the resume open right now.
    if (id === currentCloudResumeId) setActiveCloudResumeName(newName);
    showToast('✅ Renamed', 'success');
    openMyResumes(); // refresh the list with the new name
  } catch (err) {
    showToast('❌ Could not rename: ' + err.message, 'error');
  }
}

// Detaches the form from whatever resume is currently loaded so the next
// edit creates a brand new cloud row instead of overwriting it. Nothing
// is deleted or at risk: the resume being left is flushed to the cloud
// first, and stays reachable afterwards from "My Resumes".
async function startNewResume() {
  if (!currentUser) { openAuthModal('signin'); return; }

  if (currentCloudResumeId) {
    clearTimeout(autoSyncTimer);
    await silentSaveToCloud();
  }
  resumeContextVersion++; // invalidate anything else still in flight
  setActiveCloudResumeId(null);
  setActiveCloudResumeName(null);
  showToast('✅ Ready for a new resume', 'success');
  window.location.reload();
}

function closeMyResumesModal() {
  document.getElementById('myResumesModal').style.display = 'none';
}

async function loadCloudResume(id, { silent = false } = {}) {
  // Cancel any autosave still pending for whatever resume was active
  // before this, and declare that we're switching context right now —
  // this immediately invalidates any save already in flight, so it can't
  // resolve later and either yank the app back onto the old resume or
  // write its data into this one. See resumeContextVersion above.
  clearTimeout(autoSyncTimer);
  autoSyncTimer = null;
  clearTimeout(syncRetryTimer);
  const myVersion = ++resumeContextVersion;
  setCloudSyncStatus('loading');

  try {
    const { data: row, error } = await supabaseClient
      .from('resumes')
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw error;

    // If the user has since clicked to load yet another resume (this
    // fetch lost the race), don't let this now-stale response overwrite
    // whatever they've already switched to.
    if (myVersion !== resumeContextVersion) return;

    setActiveCloudResumeId(row.id);
    setActiveCloudResumeName(row.name || 'Untitled Resume');
    restoreFromData(row.data);
    // A template picked on the homepage gallery wins over the saved one.
    // Remember what was loaded, so the re-render this triggers isn't
    // mistaken for an edit. A template picked on the homepage gallery is a
    // real change from the saved one, so that is applied afterwards and
    // gets saved as usual.
    clearTimeout(autoSyncTimer);
    autoSyncTimer = null;
    loadFailedId = null;
    markSynced(formSnapshot());
    if (silent && typeof reapplyRequestedTemplate === 'function') reapplyRequestedTemplate();
    if (!silent) {
      closeMyResumesModal();
      showToast('✅ Resume loaded!', 'success');
    }
  } catch (err) {
    if (myVersion !== resumeContextVersion) return;
    // Its own state (not 'error'): retrying must re-load, never save the
    // form that's on screen over the saved resume.
    loadFailedId = id;
    setCloudSyncStatus('loadfail', err.message);
    // Silent (auto) load failing just leaves a blank form — no need to
    // alarm the user with a toast over something they didn't trigger.
    if (!silent) showToast('❌ Could not load: ' + err.message, 'error');
  }
}

// Clones a saved resume into a brand new cloud row (same data, "(Copy)"
// appended to the name) so the user can start a variant — e.g. a
// role-specific version — without retyping everything. The original row
// is untouched; nothing about the currently-open form changes either.
async function duplicateCloudResume(id) {
  try {
    const { data: row, error } = await supabaseClient
      .from('resumes')
      .select('name, data')
      .eq('id', id)
      .single();
    if (error) throw error;

    const newName = `${row.name || 'Untitled Resume'} (Copy)`;
    const { error: insertError } = await supabaseClient
      .from('resumes')
      .insert({ user_id: currentUser.id, name: newName, data: row.data });
    if (insertError) throw insertError;

    showToast('✅ Resume duplicated', 'success');
    openMyResumes(); // refresh the list to show the new copy
  } catch (err) {
    showToast('❌ Could not duplicate: ' + err.message, 'error');
  }
}

async function deleteCloudResume(id) {
  if (!confirm('Delete this saved resume? This cannot be undone.')) return;
  try {
    const { error } = await supabaseClient.from('resumes').delete().eq('id', id);
    if (error) throw error;
    if (currentCloudResumeId === id) {
      setActiveCloudResumeId(null);
      setActiveCloudResumeName(null);
      setCloudSyncStatus('idle');
    }
    showToast('✅ Resume deleted', 'success');
    openMyResumes(); // refresh the list
  } catch (err) {
    showToast('❌ Could not delete: ' + err.message, 'error');
  }
}

// Close modals on backdrop click, same behavior as the share modal.
document.addEventListener('DOMContentLoaded', async () => {
  await initAuth();
  // Homepage "Sign In" / "Sign Up" links point here as resume.html#signin /
  // #signup — open the modal automatically, in the matching mode, so it's a
  // one-click flow from the landing page. Skip if already signed in.
  if (!currentUser && (window.location.hash === '#signin' || window.location.hash === '#signup')) {
    openAuthModal(window.location.hash === '#signup' ? 'signup' : 'signin');
  }
  // After finishing the sign-up flow (email -> code -> set password) we
  // sign the user out and reload back to #signin so they log in fresh with
  // their new email + password — prefill the email and show a success toast.
  let justSignedUpEmail = null;
  try { justSignedUpEmail = sessionStorage.getItem('tr_just_signed_up_email'); } catch (e) {}
  if (justSignedUpEmail) {
    try { sessionStorage.removeItem('tr_just_signed_up_email'); } catch (e) {}
    if (!currentUser) {
      openAuthModal('signin');
      const emailInput = document.getElementById('signinEmail');
      if (emailInput) emailInput.value = justSignedUpEmail;
      showToast('✅ Account created! Please sign in.', 'success');
    }
  }
  ['authModal', 'myResumesModal', 'accountModal', 'signOutModal'].forEach(id => {
    const modal = document.getElementById(id);
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.style.display = 'none';
      });
    }
  });
});
