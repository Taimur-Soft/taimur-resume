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

  const btn = document.querySelector('[onclick="importFromGitHub()"]');
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

    // Fetch repos (top 30 by stars)
    const reposRes = await fetch(`https://api.github.com/users/${username}/repos?per_page=30&sort=stars`);
    const repos = await reposRes.json();

    // Populate personal info if fields are empty
    if (profile.name) {
      const nameParts = profile.name.split(' ');
      const firstInput = document.querySelector('.firstname');
      const lastInput = document.querySelector('.lastname');
      if (firstInput && !firstInput.value) firstInput.value = nameParts[0] || '';
      if (lastInput && !lastInput.value) lastInput.value = nameParts.slice(1).join(' ') || '';
    }

    if (profile.bio) {
      const summaryInput = document.querySelector('.summary');
      if (summaryInput && !summaryInput.value) summaryInput.value = profile.bio;
    }

    if (profile.location) {
      const addressInput = document.querySelector('.address');
      if (addressInput && !addressInput.value) addressInput.value = profile.location;
    }

    if (profile.email) {
      const emailInput = document.querySelector('.email');
      if (emailInput && !emailInput.value) emailInput.value = profile.email;
    }

    if (profile.blog) {
      const websiteInput = document.querySelector('.website');
      if (websiteInput && !websiteInput.value) websiteInput.value = profile.blog;
    }

    // Populate projects from repos
    const container = document.getElementById('projects-container');
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
    showToast(`✅ Imported from GitHub: ${profile.name || username} | ${importedCount} projects added`, 'success');

  } catch (err) {
    showToast('❌ ' + err.message, 'error');
  } finally {
    btn.innerHTML = '<i class="fab fa-github"></i> Import';
    btn.disabled = false;
  }
}
