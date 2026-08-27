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
    setCloudSyncStatus(currentCloudResumeId ? 'synced' : 'idle');

    if (currentCloudResumeId && !initialCloudLoadDone) {
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
function autoSyncToCloud() {
  if (!currentUser) return;
  clearTimeout(autoSyncTimer);
  autoSyncTimer = setTimeout(silentSaveToCloud, 1200);
}

async function silentSaveToCloud() {
  if (!currentUser) return;

  // Lock in which resume this save is FOR, before anything async happens.
  const myVersion = resumeContextVersion;
  const startId = currentCloudResumeId;

  const data = collectFormData();
  const hasData = data.personal.firstname || data.personal.lastname || data.personal.designation;
  if (!hasData) return; // nothing worth syncing yet

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
      if (myVersion === resumeContextVersion) setActiveCloudResumeId(inserted.id);
    }
    if (myVersion !== resumeContextVersion) return;
    setCloudSyncStatus('synced');
  } catch (err) {
    setCloudSyncStatus('error', err.message);
  }
}

function setCloudSyncStatus(state, errorMessage) {
  const el = document.getElementById('cloudSyncStatus');
  if (!el) return;

  if (state === 'syncing') {
    el.innerHTML = '<i class="fas fa-cloud-upload-alt fa-spin"></i> Syncing...';
    el.className = 'cloud-sync-status';
  } else if (state === 'synced') {
    el.innerHTML = '<i class="fas fa-check-circle"></i> Synced';
    el.className = 'cloud-sync-status';
  } else if (state === 'error') {
    el.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Sync failed';
    el.className = 'cloud-sync-status cloud-sync-status-error';
    el.title = errorMessage || '';
  } else if (state === 'idle') {
    el.innerHTML = '<i class="fas fa-cloud"></i> Not synced yet';
    el.className = 'cloud-sync-status';
  } else {
    el.textContent = '';
  }
}

// ── SIGN UP / SIGN IN / SIGN OUT ───────────────────────
async function authSignUp(email, password) {
  const { data, error } = await supabaseClient.auth.signUp({ email, password });
  if (error) throw error;
  return data;
}

async function authSignIn(email, password) {
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

async function authSignOut() {
  await supabaseClient.auth.signOut();
  setActiveCloudResumeId(null);
  showToast('✅ Signed out', 'success');

  // Reload rather than just flipping the nav UI: this is the one place
  // that guarantees every trace of the account's resume — form fields,
  // the live preview, in-memory state like currentTemplate/currentColor —
  // is actually wiped, so the next person on this browser starts from a
  // genuinely blank form instead of still seeing this account's data.
  setTimeout(() => window.location.reload(), 500);
}

// ── NAV AVATAR ──────────────────────────────────────────
function updateNavAvatar() {
  const el = document.getElementById('authUserAvatar');
  if (!el) return;
  const url = currentUser?.user_metadata?.avatar_url;
  el.innerHTML = url ? `<img src="${url}" alt="Avatar">` : '<i class="fas fa-user"></i>';
}

// ── ACCOUNT SETTINGS MODAL ──────────────────────────────
// Lets a signed-in user update their display name, phone number, and
// profile picture (stored in Supabase's per-user metadata — no extra
// database table needed), plus change their password. All writes go
// through supabaseClient.auth.updateUser, which only ever touches the
// currently-authenticated user's own account.
let pendingAvatarFile = null;

function openAccountModal() {
  if (!currentUser) return;
  pendingAvatarFile = null;
  document.getElementById('accountEmail').textContent = currentUser.email;
  document.getElementById('accountFullName').value = currentUser.user_metadata?.full_name || '';
  document.getElementById('accountPhone').value = currentUser.user_metadata?.phone || '';
  document.getElementById('accountNewPassword').value = '';
  document.getElementById('accountConfirmPassword').value = '';
  const preview = document.getElementById('accountAvatarPreview');
  const url = currentUser.user_metadata?.avatar_url;
  preview.innerHTML = url ? `<img src="${url}" alt="Avatar">` : '<i class="fas fa-user"></i>';
  hideAccountMessages();
  document.getElementById('accountModal').style.display = 'flex';
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
  const newPassword = document.getElementById('accountNewPassword').value;
  const confirmPassword = document.getElementById('accountConfirmPassword').value;

  if (newPassword.length < 6) {
    errorEl.textContent = 'Password must be at least 6 characters';
    errorEl.style.display = 'block';
    return;
  }
  if (newPassword !== confirmPassword) {
    errorEl.textContent = 'Passwords do not match';
    errorEl.style.display = 'block';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Updating...';
  try {
    const { error } = await supabaseClient.auth.updateUser({ password: newPassword });
    if (error) throw error;
    document.getElementById('accountNewPassword').value = '';
    document.getElementById('accountConfirmPassword').value = '';
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
let authMode = 'signin'; // 'signin' | 'signup'

function openAuthModal(mode = 'signin') {
  authMode = mode;
  document.getElementById('authModal').style.display = 'flex';
  updateAuthModalMode();
}

function closeAuthModal() {
  document.getElementById('authModal').style.display = 'none';
  const errorEl = document.getElementById('authError');
  if (errorEl) errorEl.style.display = 'none';
  const form = document.getElementById('authForm');
  if (form) form.reset();
}

function switchAuthMode() {
  authMode = authMode === 'signin' ? 'signup' : 'signin';
  updateAuthModalMode();
}

function updateAuthModalMode() {
  const title = document.getElementById('authModalTitle');
  const submitBtn = document.getElementById('authSubmitBtn');
  const switchText = document.getElementById('authSwitchText');
  const errorEl = document.getElementById('authError');
  if (errorEl) errorEl.style.display = 'none';

  if (authMode === 'signin') {
    title.innerHTML = '<i class="fas fa-user"></i> Sign In';
    submitBtn.textContent = 'Sign In';
    switchText.innerHTML = `Don't have an account? <a href="#" onclick="switchAuthMode(); return false;">Sign Up</a>`;
  } else {
    title.innerHTML = '<i class="fas fa-user-plus"></i> Create Account';
    submitBtn.textContent = 'Sign Up';
    switchText.innerHTML = `Already have an account? <a href="#" onclick="switchAuthMode(); return false;">Sign In</a>`;
  }
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const errorEl = document.getElementById('authError');
  const submitBtn = document.getElementById('authSubmitBtn');

  if (!email || !password) return;
  if (password.length < 6) {
    errorEl.style.color = 'var(--danger)';
    errorEl.textContent = 'Password must be at least 6 characters';
    errorEl.style.display = 'block';
    return;
  }

  submitBtn.disabled = true;
  const originalText = submitBtn.textContent;
  submitBtn.textContent = 'Please wait...';
  errorEl.style.display = 'none';

  try {
    if (authMode === 'signup') {
      const data = await authSignUp(email, password);
      if (data.user && !data.session) {
        // Email confirmation is required before this account can sign in.
        errorEl.style.color = 'var(--success)';
        errorEl.textContent = '✅ Account created! Please check your email to confirm before signing in.';
        errorEl.style.display = 'block';
      } else {
        showToast('✅ Account created!', 'success');
        closeAuthModal();
      }
    } else {
      await authSignIn(email, password);
      showToast('✅ Signed in!', 'success');
      closeAuthModal();
    }
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

  // Lock in which resume this save is FOR, before anything async happens —
  // see the comment on resumeContextVersion above.
  const myVersion = resumeContextVersion;
  const startId = currentCloudResumeId;

  const data = collectFormData();

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
      if (myVersion === resumeContextVersion) setActiveCloudResumeId(inserted.id);
      showToast('✅ Resume saved to cloud!', 'success');
    }
    if (myVersion === resumeContextVersion) setCloudSyncStatus('synced');
  } catch (err) {
    setCloudSyncStatus('error', err.message);
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
      listEl.innerHTML = '<div class="empty-state"><i class="fas fa-cloud"></i><p>No saved resumes yet. Click "Save to Cloud" to save your current resume.</p></div>';
      return;
    }

    listEl.innerHTML = resumes.map(r => `
      <div class="my-resume-item" data-id="${r.id}">
        <div class="my-resume-info">
          <strong>${escapeHTML(r.name || 'Untitled Resume')}</strong>
          <span>${new Date(r.updated_at).toLocaleString()}</span>
        </div>
        <div class="my-resume-actions">
          <button onclick="loadCloudResume('${r.id}')" class="btn-icon" title="Load"><i class="fas fa-folder-open"></i></button>
          <button onclick="startRenameResume(this)" class="btn-icon" title="Rename"><i class="fas fa-pen"></i></button>
          <button onclick="deleteCloudResume('${r.id}')" class="remove-btn" title="Delete"><i class="fas fa-trash-alt"></i></button>
        </div>
      </div>`).join('');
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
  const nameEl = item.querySelector('.my-resume-info strong');
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
  const myVersion = ++resumeContextVersion;

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
    restoreFromData(row.data);
    setCloudSyncStatus('synced');
    if (!silent) {
      closeMyResumesModal();
      showToast('✅ Resume loaded!', 'success');
    }
  } catch (err) {
    // Silent (auto) load failing just leaves a blank form — no need to
    // alarm the user over something they didn't explicitly trigger.
    if (!silent) showToast('❌ Could not load: ' + err.message, 'error');
  }
}

async function deleteCloudResume(id) {
  if (!confirm('Delete this saved resume? This cannot be undone.')) return;
  try {
    const { error } = await supabaseClient.from('resumes').delete().eq('id', id);
    if (error) throw error;
    if (currentCloudResumeId === id) {
      setActiveCloudResumeId(null);
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
  ['authModal', 'myResumesModal', 'accountModal'].forEach(id => {
    const modal = document.getElementById(id);
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.style.display = 'none';
      });
    }
  });
});
