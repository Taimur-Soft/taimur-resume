// ======================================================
// Auth + Cloud Save Module (Supabase)
// Handles sign up / sign in / sign out, and saving, listing, loading
// and deleting resumes tied to the logged-in user's account.
// Depends on: supabaseClient (supabase-config.js), and collectFormData(),
// restoreFromData(), escapeHTML(), showToast() from app.js.
// ======================================================

'use strict';

let currentUser = null;
let currentCloudResumeId = null; // the cloud row currently loaded/being edited, if any

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
    if (emailLabel) emailLabel.textContent = currentUser.email;
  } else {
    signedOut.style.display = 'flex';
    signedIn.style.display = 'none';
    currentCloudResumeId = null;
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
  currentCloudResumeId = null;
  showToast('✅ Signed out', 'success');
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

  const data = collectFormData();
  const name = [data.personal.firstname, data.personal.lastname].filter(Boolean).join(' ') || 'Untitled Resume';

  try {
    if (currentCloudResumeId) {
      const { error } = await supabaseClient
        .from('resumes')
        .update({ name, data, updated_at: new Date().toISOString() })
        .eq('id', currentCloudResumeId);
      if (error) throw error;
      showToast('✅ Resume updated in cloud!', 'success');
    } else {
      const { data: inserted, error } = await supabaseClient
        .from('resumes')
        .insert({ user_id: currentUser.id, name, data })
        .select()
        .single();
      if (error) throw error;
      currentCloudResumeId = inserted.id;
      showToast('✅ Resume saved to cloud!', 'success');
    }
  } catch (err) {
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
      <div class="my-resume-item">
        <div class="my-resume-info">
          <strong>${escapeHTML(r.name || 'Untitled Resume')}</strong>
          <span>${new Date(r.updated_at).toLocaleString()}</span>
        </div>
        <div class="my-resume-actions">
          <button onclick="loadCloudResume('${r.id}')" class="btn-icon" title="Load"><i class="fas fa-folder-open"></i></button>
          <button onclick="deleteCloudResume('${r.id}')" class="remove-btn" title="Delete"><i class="fas fa-trash-alt"></i></button>
        </div>
      </div>`).join('');
  } catch (err) {
    listEl.innerHTML = `<div class="ai-error">❌ ${err.message}</div>`;
  }
}

function closeMyResumesModal() {
  document.getElementById('myResumesModal').style.display = 'none';
}

async function loadCloudResume(id) {
  try {
    const { data: row, error } = await supabaseClient
      .from('resumes')
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw error;

    currentCloudResumeId = row.id;
    restoreFromData(row.data);
    closeMyResumesModal();
    showToast('✅ Resume loaded!', 'success');
  } catch (err) {
    showToast('❌ Could not load: ' + err.message, 'error');
  }
}

async function deleteCloudResume(id) {
  if (!confirm('Delete this saved resume? This cannot be undone.')) return;
  try {
    const { error } = await supabaseClient.from('resumes').delete().eq('id', id);
    if (error) throw error;
    if (currentCloudResumeId === id) currentCloudResumeId = null;
    showToast('✅ Resume deleted', 'success');
    openMyResumes(); // refresh the list
  } catch (err) {
    showToast('❌ Could not delete: ' + err.message, 'error');
  }
}

// Close modals on backdrop click, same behavior as the share modal.
document.addEventListener('DOMContentLoaded', () => {
  initAuth();
  ['authModal', 'myResumesModal'].forEach(id => {
    const modal = document.getElementById(id);
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.style.display = 'none';
      });
    }
  });
});
