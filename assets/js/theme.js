// ======================================================
// Theme (light / dark) toggle
// Load this in <head>, before the page renders, so a saved dark choice
// is applied before the first paint (no white flash).
// With nothing saved, the site follows the operating system setting.
// ======================================================
(function () {
  var STORAGE_KEY = 'theme';
  var root = document.documentElement;
  var media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function savedTheme() {
    try {
      var t = localStorage.getItem(STORAGE_KEY);
      return t === 'dark' || t === 'light' ? t : null;
    } catch (e) { return null; }
  }

  function currentTheme() {
    var attr = root.getAttribute('data-theme');
    if (attr === 'dark' || attr === 'light') return attr;
    return media && media.matches ? 'dark' : 'light';
  }

  function updateButtons() {
    var dark = currentTheme() === 'dark';
    var buttons = document.querySelectorAll('.theme-toggle');
    for (var i = 0; i < buttons.length; i++) {
      var btn = buttons[i];
      var icon = btn.querySelector('i');
      if (icon) icon.className = dark ? 'fas fa-sun' : 'fas fa-moon';
      var label = dark ? 'Switch to light mode' : 'Switch to dark mode';
      btn.setAttribute('aria-label', label);
      btn.setAttribute('title', label);
    }
  }

  // Apply a saved choice right away.
  var saved = savedTheme();
  if (saved) root.setAttribute('data-theme', saved);

  window.toggleTheme = function () {
    var next = currentTheme() === 'dark' ? 'light' : 'dark';
    var system = media && media.matches ? 'dark' : 'light';
    root.classList.add('theme-anim');
    if (next === system) {
      // Back to what the computer uses: forget the choice, so the site
      // follows the system setting again (e.g. dark at night).
      root.removeAttribute('data-theme');
      try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
    } else {
      root.setAttribute('data-theme', next);
      try { localStorage.setItem(STORAGE_KEY, next); } catch (e) {}
    }
    updateButtons();
    setTimeout(function () { root.classList.remove('theme-anim'); }, 300);
  };

  // Keep the icon in sync if the OS theme changes while nothing is saved.
  if (media) {
    var onChange = function () { if (!savedTheme()) updateButtons(); };
    if (media.addEventListener) media.addEventListener('change', onChange);
    else if (media.addListener) media.addListener(onChange);
  }

  document.addEventListener('DOMContentLoaded', updateButtons);
})();
