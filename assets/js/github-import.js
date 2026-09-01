// ======================================================
// GitHub Import Module
// Uses GitHub Public API — No token required (60 req/hr)
// ======================================================

async function importFromGitHub() {
  const username = document.getElementById('githubUsername').value.trim();
  if (!username) {
    showToast('Please enter a GitHub username', 'error');
    return;
  }

  const btn = document.getElementById('githubImportBtn');
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Importing...';
  btn.disabled = true;

  try {
    // Fetch user profile
    const profileRes = await fetch(`https://api.github.com/users/${username}`);
    if (!profileRes.ok) {
      if (profileRes.status === 404) throw new Error('GitHub user not found');
      if (profileRes.status === 403) throw new Error('API rate limit reached. Try again in an hour.');
      throw new Error('Failed to fetch GitHub profile');
    }
    const profile = await profileRes.json();

    // Fetch repos (top 30 by stars). Note: GitHub's API only supports
    // sort=created|updated|pushed|full_name — there is no "stars" option —
    // so we fetch by most recently pushed and sort by stargazers client-side.
    const reposRes = await fetch(`https://api.github.com/users/${username}/repos?per_page=30&sort=pushed`);
    if (!reposRes.ok) {
      if (reposRes.status === 403) throw new Error('API rate limit reached. Try again in an hour.');
      throw new Error('Failed to fetch GitHub repositories');
    }
    const repos = (await reposRes.json())
      .sort((a, b) => (b.stargazers_count || 0) - (a.stargazers_count || 0));

    // Populate personal info if fields are empty. Track what actually
    // changed vs. what was skipped, so the final message can say exactly
    // what happened instead of a blanket "success" that hides the fact
    // that GitHub simply had nothing public to offer for a field, or that
    // the field already had a value and was left alone on purpose.
    const filled = [];
    const skippedExisting = [];
    const notOnProfile = [];

    function applyField(profileValue, input, label) {
      if (!profileValue) { notOnProfile.push(label); return; }
      if (!input) return;
      if (input.value) { skippedExisting.push(label); return; }
      input.value = profileValue;
      filled.push(label);
    }

    if (profile.name) {
      const nameParts = profile.name.split(' ');
      applyField(nameParts[0] || '', document.querySelector('.firstname'), 'first name');
      applyField(nameParts.slice(1).join(' ') || nameParts[0] || '', document.querySelector('.lastname'), 'last name');
    } else {
      notOnProfile.push('name');
    }

    applyField(profile.bio, document.querySelector('.summary'), 'summary');
    applyField(profile.location, document.querySelector('.address'), 'address');
    applyField(profile.email, document.querySelector('.email'), 'email');
    applyField(profile.blog, document.querySelector('.website'), 'website');

    // Populate projects from repos
    let importedCount = 0;

    for (const repo of repos.slice(0, 6)) {
      if (repo.fork) continue; // Skip forked repos
      if (importedCount >= 5) break;

      // Get languages
      let langStr = repo.language || '';

      // Build description
      const desc = [
        repo.description || '',
        langStr ? `Language: ${langStr}` : '',
        `⭐ ${repo.stargazers_count} stars`
      ].filter(Boolean).join(' | ');

      addRepeaterItem('projects', {
        proj_title: repo.name,
        proj_link: repo.html_url,
        proj_description: desc
      });

      importedCount++;
    }

    generateCV();

    // Build an honest summary instead of a blanket "imported!" message —
    // if nothing actually changed, say so plainly rather than showing a
    // green checkmark for a no-op.
    const parts = [];
    if (filled.length) parts.push(`filled ${filled.join(', ')}`);
    if (importedCount) parts.push(`added ${importedCount} project${importedCount > 1 ? 's' : ''}`);

    if (parts.length) {
      let msg = `✅ Imported from GitHub: ${parts.join(' · ')}`;
      if (skippedExisting.length) msg += ` (kept existing ${skippedExisting.join(', ')})`;
      showToast(msg, 'success');
    } else {
      const reasons = [];
      if (notOnProfile.length) reasons.push(`${notOnProfile.join(', ')} not public on this GitHub profile`);
      if (skippedExisting.length) reasons.push(`${skippedExisting.join(', ')} already filled in`);
      if (!importedCount) reasons.push('no public non-fork repos found');
      showToast(`⚠️ Nothing new to import — ${reasons.join('; ')}`, 'error');
    }

  } catch (err) {
    showToast('❌ ' + err.message, 'error');
  } finally {
    btn.innerHTML = '<i class="fab fa-github"></i> Import';
    btn.disabled = false;
  }
}
