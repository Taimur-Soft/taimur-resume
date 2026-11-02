// ======================================================
// GitHub Import Module
// Uses GitHub Public API — No token required (60 req/hr)
// ======================================================

// Accepts a plain username, "@username", or a pasted profile/repo link
// such as "https://github.com/Taimur-Soft/" and returns just the username.
function parseGitHubUsername(input) {
  let s = (input || '').trim();
  const urlMatch = s.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([^\/?#\s]+)/i);
  if (urlMatch) s = urlMatch[1];
  s = s.replace(/^@/, '').replace(/\/+$/, '');
  // GitHub usernames: letters, digits and single hyphens, up to 39 chars.
  return /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i.test(s) ? s : null;
}

function githubRateLimitMessage(res) {
  const reset = Number(res.headers.get('x-ratelimit-reset'));
  if (!reset) return 'GitHub limit reached (60 imports per hour). Please try again later.';
  const mins = Math.max(1, Math.ceil((reset * 1000 - Date.now()) / 60000));
  return `GitHub limit reached (60 requests per hour). Try again in about ${mins} min.`;
}

async function fetchGitHub(url) {
  let res;
  try {
    res = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
  } catch (e) {
    throw new Error('Could not reach GitHub. Check your internet connection.');
  }
  if (res.ok) return res.json();
  if (res.status === 404) throw new Error('GitHub user not found. Check the username.');
  if ((res.status === 403 || res.status === 429) && res.headers.get('x-ratelimit-remaining') === '0') {
    throw new Error(githubRateLimitMessage(res));
  }
  throw new Error(`GitHub returned an error (${res.status}). Please try again.`);
}

// Turns "my-cool_app" into "My Cool App" for a nicer project title.
function prettyRepoName(name) {
  return name.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
}

function repoDescription(repo) {
  const lines = [];
  lines.push(repo.description
    ? repo.description.trim().replace(/\.?$/, '.')
    : (repo.language ? `Project built with ${repo.language}.` : 'Open-source project.'));
  // Language first, then a few topics; skip case-only duplicates such as
  // "TypeScript" and "typescript".
  const seen = new Set();
  const tech = [repo.language, ...(repo.topics || [])]
    .filter(Boolean)
    .filter(t => { const k = t.toLowerCase().replace(/[^a-z0-9+#]/g, ''); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, 4);
  if (tech.length) lines.push(`Tech: ${tech.join(', ')}`);
  if (repo.homepage) lines.push(`Live demo: ${repo.homepage}`);
  // Stars only help when there are some to show.
  if (repo.stargazers_count >= 5) lines.push(`⭐ ${repo.stargazers_count} stars on GitHub`);
  return lines.join('\n');
}

async function importFromGitHub() {
  const input = document.getElementById('githubUsername');
  const raw = input.value.trim();
  if (!raw) {
    showToast('Please enter a GitHub username', 'error');
    input.focus();
    return;
  }
  const username = parseGitHubUsername(raw);
  if (!username) {
    showToast('❌ That doesn\'t look like a GitHub username. Enter e.g. Taimur-Soft or github.com/Taimur-Soft', 'error');
    input.focus();
    return;
  }
  input.value = username;

  const btn = document.getElementById('githubImportBtn');
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Importing...';
  btn.disabled = true;

  try {
    const enc = encodeURIComponent(username);
    // Both requests at once. GitHub can't sort by stars here, so fetch the
    // most recently pushed repos and rank them below.
    const [profile, allRepos] = await Promise.all([
      fetchGitHub(`https://api.github.com/users/${enc}`),
      fetchGitHub(`https://api.github.com/users/${enc}/repos?per_page=100&sort=pushed`)
    ]);

    // Track what actually changed vs. what was skipped, so the final
    // message says exactly what happened.
    const filled = [];
    const skippedExisting = [];
    const notOnProfile = [];

    function applyField(profileValue, el, label) {
      if (!profileValue) { notOnProfile.push(label); return; }
      if (!el) return;
      // "kept your existing website", not "…website (GitHub profile)".
      if (el.value.trim()) { skippedExisting.push(label.replace(/\s*\(.*\)$/, '')); return; }
      el.value = profileValue;
      if (el.dataset.count && typeof updateCharCount === 'function') updateCharCount(el);
      filled.push(label);
    }

    if (profile.name) {
      const nameParts = profile.name.trim().split(/\s+/);
      applyField(nameParts[0], document.querySelector('.firstname'), 'first name');
      if (nameParts.length > 1) applyField(nameParts.slice(1).join(' '), document.querySelector('.lastname'), 'last name');
    } else {
      notOnProfile.push('name');
    }

    applyField(profile.bio, document.querySelector('.summary'), 'summary');
    applyField(profile.location, document.querySelector('.address'), 'address');
    applyField(profile.email, document.querySelector('.email'), 'email');
    // No personal website on GitHub? The GitHub profile itself is the next
    // best link for a developer resume.
    let site = profile.blog || profile.html_url;
    if (site && !/^https?:\/\//i.test(site)) site = 'https://' + site;
    applyField(site, document.querySelector('.website'), profile.blog ? 'website' : 'website (your GitHub profile link)');

    // Projects: own (non-fork, non-archived) repos, best first. Skip ones
    // already on the resume so importing twice doesn't add duplicates.
    const existing = new Set(
      [...document.querySelectorAll('#projects-container .repeater-item')].flatMap(item => [
        (item.querySelector('.proj_link')?.value || '').trim().toLowerCase().replace(/\/+$/, ''),
        (item.querySelector('.proj_title')?.value || '').trim().toLowerCase()
      ]).filter(Boolean)
    );
    const repos = allRepos
      .filter(r => !r.fork && !r.archived && r.name.toLowerCase() !== username.toLowerCase())
      .sort((a, b) => (b.stargazers_count - a.stargazers_count) || (new Date(b.pushed_at) - new Date(a.pushed_at)));

    let importedCount = 0;
    let duplicateCount = 0;
    for (const repo of repos) {
      if (importedCount >= 5) break;
      const title = prettyRepoName(repo.name);
      const link = (repo.homepage || repo.html_url);
      if ([repo.html_url, repo.homepage, title, repo.name].some(x => x && existing.has(x.toLowerCase().replace(/\/+$/, '')))) {
        duplicateCount++;
        continue;
      }
      const prefill = { proj_title: title, proj_link: repo.html_url, proj_description: repoDescription(repo) };
      // Reuse a blank project card if there is one instead of leaving it empty.
      const blank = [...document.querySelectorAll('#projects-container .repeater-item')]
        .find(item => ['proj_title', 'proj_link', 'proj_description'].every(c => !(item.querySelector('.' + c)?.value || '').trim()));
      if (blank) {
        for (const [cls, val] of Object.entries(prefill)) blank.querySelector('.' + cls).value = val;
        refreshItemUI(blank);
      } else {
        addRepeaterItem('projects', prefill);
      }
      existing.add(repo.html_url.toLowerCase());
      if (link) existing.add(link.toLowerCase());
      importedCount++;
    }

    // Programming languages used across those repos → Skills, if missing.
    const haveSkills = new Set([...document.querySelectorAll('#skills-container .skill')].map(i => i.value.trim().toLowerCase()));
    const langCounts = {};
    repos.forEach(r => { if (r.language) langCounts[r.language] = (langCounts[r.language] || 0) + 1; });
    const newSkills = Object.keys(langCounts)
      .sort((a, b) => langCounts[b] - langCounts[a])
      .filter(l => !haveSkills.has(l.toLowerCase()))
      .slice(0, 5);
    newSkills.forEach(l => addSuggestedSkill(l));

    generateCV();
    if (typeof updateStepChecks === 'function') updateStepChecks();

    const parts = [];
    if (filled.length) parts.push(`filled ${filled.join(', ')}`);
    if (importedCount) parts.push(`added ${importedCount} project${importedCount > 1 ? 's' : ''}`);
    if (newSkills.length) parts.push(`added skill${newSkills.length > 1 ? 's' : ''} ${newSkills.join(', ')}`);

    const notes = [];
    if (duplicateCount) notes.push(`${duplicateCount} project${duplicateCount > 1 ? 's were' : ' was'} already added`);
    if (skippedExisting.length) notes.push(`kept your existing ${skippedExisting.join(', ')}`);
    const missing = notOnProfile.filter(f => ['name', 'summary', 'address'].includes(f));
    if (missing.length) notes.push(`${missing.join(', ')} not public on GitHub`);
    if (!repos.length) notes.push('no public repositories of your own found');

    if (parts.length) {
      showToast(`✅ Imported from GitHub: ${parts.join(' · ')}${notes.length ? ` (${notes.join('; ')})` : ''}`, 'success');
    } else {
      showToast(`⚠️ Nothing new to import: ${notes.join('; ') || 'everything is already on your resume'}`, 'error');
    }
  } catch (err) {
    showToast('❌ ' + err.message, 'error');
  } finally {
    btn.innerHTML = '<i class="fab fa-github"></i> Import';
    btn.disabled = false;
  }
}

// Press Enter in the username box to import.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id === 'githubUsername') {
    e.preventDefault();
    if (!document.getElementById('githubImportBtn')?.disabled) importFromGitHub();
  }
});
