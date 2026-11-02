// ======================================================
// Taimur Rahman Resume Builder — Main App
// Features: Live Preview, 15 Europass-format Templates, Drag & Drop,
//           Wizard, JSON Import/Export, Auto-Save,
//           Custom Sections, Progress Tracker
// ======================================================

'use strict';

// ── STATE ──────────────────────────────────────────────
let currentTemplate = 'aurora';
let customSections = [];
let sectionOrder = ['experience', 'education', 'skills', 'projects', 'achievements'];
let activeStep = 'personal';

// ── INIT ───────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Deliberately no local-storage restore here: previous data must never
  // reappear for a different signed-out visitor on the same browser.
  // Signed-in users get their resume back via auth.js's cloud auto-load
  // instead; a signed-out visitor always starts from a blank form.
  // One-time cleanup: purge any resume data a pre-fix version of this app
  // left sitting in this browser's local storage, so it can't leak either.
  try { localStorage.removeItem('tr_resume_data'); } catch (e) {}
  initSortableSections();
  addInitialItems();
  applyRequestedTemplate();
  renderCV(); // instant first paint — bypass the debounce used for typing
  calculateProgress();
});

// ── TEMPLATE FROM LINK ─────────────────────────────────
// The homepage template gallery links to resume.html?template=<name>.
// Apply it on load, and remember it so a signed-in user's cloud resume
// (loaded a moment later by auth.js) doesn't override that explicit choice.
let requestedTemplate = null;

function applyRequestedTemplate() {
  let name = null;
  try { name = new URLSearchParams(window.location.search).get('template'); } catch (e) {}
  if (!name || !document.querySelector(`.template-card[data-template="${CSS.escape(name)}"]`)) return;

  requestedTemplate = name;
  switchTemplate(name);

  // Drop the parameter so a refresh doesn't keep forcing the template.
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete('template');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  } catch (e) {}

  const label = name.charAt(0).toUpperCase() + name.slice(1);
  setTimeout(() => showToast(`✅ ${label} template selected`, 'success'), 300);
}

// Called by auth.js after it restores a saved resume.
function reapplyRequestedTemplate() {
  if (!requestedTemplate) return;
  switchTemplate(requestedTemplate);
  requestedTemplate = null;
}

function addInitialItems() {
  const experienceContainer = document.getElementById('experience-container');
  if (!experienceContainer.children.length) addRepeaterItem('experience');

  const educationContainer = document.getElementById('education-container');
  if (!educationContainer.children.length) addRepeaterItem('education');

  const skillsContainer = document.getElementById('skills-container');
  if (!skillsContainer.children.length) {
    addRepeaterItem('skills');
    addRepeaterItem('skills');
  }

  const projectsContainer = document.getElementById('projects-container');
  if (!projectsContainer.children.length) addRepeaterItem('projects');
}

// ── FIELD VALIDATION ───────────────────────────────────
// Non-blocking: just flags obviously malformed input on blur so people
// notice a typo before sharing their resume. Doesn't stop typing/generateCV.
const FIELD_VALIDATORS = {
  email: {
    test: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
    message: 'That doesn\'t look like a valid email address'
  },
  phoneno: {
    test: (v) => /^[+()\d][\d\s().-]{5,}$/.test(v),
    message: 'That doesn\'t look like a valid phone number'
  },
  website: {
    test: (v) => /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+([/?#].*)?$/i.test(v),
    message: 'That doesn\'t look like a valid website URL'
  }
};

function validateField(el) {
  const rule = Object.keys(FIELD_VALIDATORS).find(cls => el.classList.contains(cls));
  if (!rule) return;

  const value = el.value.trim();
  const { test, message } = FIELD_VALIDATORS[rule];

  // Empty is fine here — required-ness is a separate concern (see the
  // progress tracker); this only flags input that's actually present
  // but malformed.
  const isValid = value === '' || test(value);

  el.classList.toggle('field-invalid', !isValid);

  let errorEl = el.parentElement.querySelector('.field-error-msg');
  if (!isValid) {
    if (!errorEl) {
      errorEl = document.createElement('span');
      errorEl.className = 'field-error-msg';
      el.insertAdjacentElement('afterend', errorEl);
    }
    errorEl.textContent = message;
  } else if (errorEl) {
    errorEl.remove();
  }
}

// ── TEMPLATE SYSTEM ────────────────────────────────────
function switchTemplate(name) {
  currentTemplate = name;

  // Update card UI
  document.querySelectorAll('.template-card').forEach(c => c.classList.remove('active'));
  const card = document.querySelector(`[data-template="${name}"]`);
  if (card) card.classList.add('active');

  // Update preview class
  const preview = document.getElementById('resumePreview');
  preview.className = `resume-preview template-${name}`;

  generateCV();
}


// ── GENERATE CV (LIVE PREVIEW) ─────────────────────────
// renderCV() does the actual (somewhat expensive) work: rebuilding the
// whole preview's innerHTML from scratch. generateCV() is what every
// onkeyup/onchange handler in the templates actually calls — it debounces
// down to one renderCV() per short burst of input, instead of one full
// re-render per keystroke.
let renderCVTimer = null;
function generateCV() {
  clearTimeout(renderCVTimer);
  renderCVTimer = setTimeout(renderCV, 150);
}

function renderCV() {
  const data = collectFormData();
  const preview = document.getElementById('resumePreview');
  const empty = document.getElementById('previewEmpty');

  const hasData = data.personal.firstname || data.personal.lastname || data.personal.designation;

  if (!hasData) {
    if (empty) empty.style.display = 'flex';
    return;
  }

  if (empty) empty.style.display = 'none';

  preview.innerHTML = buildResumeHTML(data);

  calculateProgress();
  pushHistory();

  // Cloud auto-sync (auth.js) is optional — only push when a viewer is
  // actually signed in, and never let its absence break the local save path.
  if (typeof autoSyncToCloud === 'function') autoSyncToCloud();
}

// ── UNDO / REDO ─────────────────────────────────────────
// Snapshots the whole form (via collectFormData/restoreFromData, which
// already exist for JSON import/export) after each real render — not
// per keystroke, since renderCV() itself is already debounced. Lets
// people step back after accidentally clearing a field or deleting an
// item. Deliberately not bound to Ctrl+Z: that would fight with the
// browser's own per-field undo while someone is typing.
const historyStack = [];
let historyIndex = -1;
let isRestoringHistory = false;
const MAX_HISTORY = 50;

function pushHistory() {
  if (isRestoringHistory) return;
  const snapshot = JSON.stringify(collectFormData());
  if (historyStack[historyIndex] === snapshot) return; // nothing actually changed

  historyStack.splice(historyIndex + 1); // drop the old redo branch, if any
  historyStack.push(snapshot);
  if (historyStack.length > MAX_HISTORY) historyStack.shift();
  historyIndex = historyStack.length - 1;
  updateHistoryButtons();
}

function undo() {
  if (historyIndex <= 0) return;
  historyIndex--;
  applyHistorySnapshot(historyStack[historyIndex]);
}

function redo() {
  if (historyIndex >= historyStack.length - 1) return;
  historyIndex++;
  applyHistorySnapshot(historyStack[historyIndex]);
}

function applyHistorySnapshot(json) {
  isRestoringHistory = true;
  try {
    restoreFromData(JSON.parse(json));
  } finally {
    isRestoringHistory = false;
  }
  updateHistoryButtons();
}

function updateHistoryButtons() {
  const undoBtn = document.getElementById('undoBtn');
  const redoBtn = document.getElementById('redoBtn');
  if (undoBtn) undoBtn.disabled = historyIndex <= 0;
  if (redoBtn) redoBtn.disabled = historyIndex >= historyStack.length - 1;
}

function collectFormData() {
  const get = (cls) => {
    const el = document.querySelector(`.${cls}`);
    return el ? el.value.trim() : '';
  };

  // Experience
  const experiences = [];
  document.querySelectorAll('#experience-container .repeater-item').forEach(item => {
    experiences.push({
      title: item.querySelector('.exp_title')?.value || '',
      organization: item.querySelector('.exp_organization')?.value || '',
      location: item.querySelector('.exp_location')?.value || '',
      startDate: item.querySelector('.exp_start_date')?.value || '',
      endDate: item.querySelector('.exp_end_date')?.value || '',
      current: item.querySelector('.exp_current')?.checked || false,
      description: item.querySelector('.exp_description')?.value || ''
    });
  });

  // Education
  const educations = [];
  document.querySelectorAll('#education-container .repeater-item').forEach(item => {
    educations.push({
      school: item.querySelector('.edu_school')?.value || '',
      degree: item.querySelector('.edu_degree')?.value || '',
      city: item.querySelector('.edu_city')?.value || '',
      startDate: item.querySelector('.edu_start_date')?.value || '',
      endDate: item.querySelector('.edu_graduation_date')?.value || '',
      description: item.querySelector('.edu_description')?.value || ''
    });
  });

  // Skills
  const skills = [];
  document.querySelectorAll('#skills-container .repeater-item').forEach(item => {
    const skill = item.querySelector('.skill')?.value || '';
    const level = item.querySelector('.skill_level')?.value || '80';
    if (skill) skills.push({ skill, level });
  });

  // Projects
  const projects = [];
  document.querySelectorAll('#projects-container .repeater-item').forEach(item => {
    projects.push({
      title: item.querySelector('.proj_title')?.value || '',
      link: item.querySelector('.proj_link')?.value || '',
      description: item.querySelector('.proj_description')?.value || ''
    });
  });

  // Achievements
  const achievements = [];
  document.querySelectorAll('#achievements-container .repeater-item').forEach(item => {
    achievements.push({
      title: item.querySelector('.achieve_title')?.value || '',
      description: item.querySelector('.achieve_description')?.value || ''
    });
  });

  // Languages (CEFR self-assessment)
  const languages = [];
  document.querySelectorAll('#languages-container .repeater-item').forEach(item => {
    const lang = {
      language: item.querySelector('.lang_name')?.value || '',
      mother: item.querySelector('.lang_mother')?.checked || false
    };
    CEFR_SKILLS.forEach(s => { lang[s.key] = item.querySelector(`.lang_${s.key}`)?.value || ''; });
    languages.push(lang);
  });

  // Custom sections
  const customs = [];
  document.querySelectorAll('.custom-section-block').forEach(block => {
    const name = block.querySelector('.custom-section-name')?.textContent || 'Section';
    const items = [];
    block.querySelectorAll('.custom-item').forEach(item => {
      items.push({
        title: item.querySelector('.custom_title')?.value || '',
        description: item.querySelector('.custom_description')?.value || ''
      });
    });
    customs.push({ name, items });
  });

  // Image
  const imageEl = document.getElementById('image_dsp');
  const imageSrc = hasPhoto() ? imageEl.src : '';

  return {
    template: currentTemplate,
    personal: {
      firstname: get('firstname'),
      middlename: get('middlename'),
      lastname: get('lastname'),
      designation: get('designation'),
      address: get('address'),
      email: get('email'),
      phoneno: get('phoneno'),
      website: get('website'),
      summary: get('summary'),
      image: imageSrc
    },
    experiences,
    educations,
    skills,
    projects,
    achievements,
    languages,
    customSections: customs
  };
}

// ── SECURITY: sanitization helpers ─────────────────────
// NOTE: resume data can come from an UNTRUSTED source (a shared link decoded
// in view.html), not just this app's own form. Every string that ends up in
// buildResumeHTML() must be escaped here so it can never break out of the
// HTML it's interpolated into.

function escapeHTML(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// For values used inside href="" — only allow http(s)/mailto links,
// blocking javascript: and other script-executing schemes.
function sanitizeURL(url) {
  if (!url) return '';
  const trimmed = String(url).trim();
  if (/^(https?:|mailto:)/i.test(trimmed)) return escapeHTML(trimmed);
  if (/^[a-z0-9.-]+\.[a-z]{2,}([/?#].*)?$/i.test(trimmed)) return escapeHTML('https://' + trimmed);
  return '';
}

// For values used inside src="" on <img> — only allow local data:image
// URLs (from the file picker) or https images, blocking data:text/html etc.
function sanitizeImageSrc(src) {
  if (!src) return '';
  if (/^data:image\//i.test(src) || /^https:\/\//i.test(src)) return src;
  return '';
}

// Produces an escaped, safe-to-render copy of the resume data. Everything
// downstream in buildResumeHTML() can then interpolate these fields as-is.
function sanitizeResumeData(raw) {
  const personal = raw.personal || {};
  return {
    personal: {
      firstname: escapeHTML(personal.firstname),
      middlename: escapeHTML(personal.middlename),
      lastname: escapeHTML(personal.lastname),
      designation: escapeHTML(personal.designation),
      address: escapeHTML(personal.address),
      email: escapeHTML(personal.email),
      phoneno: escapeHTML(personal.phoneno),
      website: escapeHTML(personal.website),
      summary: escapeHTML(personal.summary),
      image: sanitizeImageSrc(personal.image)
    },
    experiences: (raw.experiences || []).map(e => ({
      title: escapeHTML(e.title),
      organization: escapeHTML(e.organization),
      location: escapeHTML(e.location),
      startDate: e.startDate || '',
      endDate: e.endDate || '',
      current: !!e.current,
      description: escapeHTML(e.description)
    })),
    educations: (raw.educations || []).map(e => ({
      school: escapeHTML(e.school),
      degree: escapeHTML(e.degree),
      city: escapeHTML(e.city),
      startDate: e.startDate || '',
      endDate: e.endDate || '',
      description: escapeHTML(e.description)
    })),
    skills: (raw.skills || []).map(s => ({
      skill: escapeHTML(s.skill),
      level: Math.min(100, Math.max(0, Number(s.level) || 0))
    })),
    projects: (raw.projects || []).map(p => ({
      title: escapeHTML(p.title),
      link: sanitizeURL(p.link),
      description: escapeHTML(p.description)
    })),
    achievements: (raw.achievements || []).map(a => ({
      title: escapeHTML(a.title),
      description: escapeHTML(a.description)
    })),
    // Only real CEFR codes get through; anything else becomes empty.
    languages: (raw.languages || []).map(l => {
      const lang = { language: escapeHTML(l.language), mother: !!l.mother };
      CEFR_SKILLS.forEach(s => { lang[s.key] = CEFR_LEVELS.some(c => c.code === l[s.key]) ? l[s.key] : ''; });
      return lang;
    }),
    customSections: (raw.customSections || []).map(cs => ({
      name: escapeHTML(cs.name),
      items: (cs.items || []).map(i => ({
        title: escapeHTML(i.title),
        description: escapeHTML(i.description)
      }))
    }))
  };
}

// ── RESUME HTML BUILDER ────────────────────────────────
function buildResumeHTML(rawData) {
  const data = sanitizeResumeData(rawData);
  const { personal, experiences, educations, skills, projects, achievements, languages, customSections } = data;

  const fullName = [personal.firstname, personal.middlename, personal.lastname].filter(Boolean).join(' ');
  const formatDate = (d) => {
    // Only accept the exact "YYYY-MM" shape produced by <input type="month">.
    // Anything else (including data crafted by hand in a shared link) is
    // rejected here rather than being interpolated into the page unescaped.
    if (!d || typeof d !== 'string') return '';
    const match = /^(\d{4})-(\d{2})$/.exec(d.trim());
    if (!match) return '';
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const idx = parseInt(match[2], 10) - 1;
    if (idx < 0 || idx > 11) return '';
    return `${months[idx]} ${match[1]}`;
  };

  // ---- EUROPASS TEMPLATE SYSTEM ----
  // All 15 templates share the same EU-recognized section structure
  // (Personal info → About Me → Work Experience → Education and Training →
  // Personal Skills → Projects → Achievements → custom sections). Only the
  // layout (sidebar / banner / timeline) and the visual theme differ, so the
  // markup below is built once per layout and skinned entirely through CSS
  // (see .theme-* variables in main.css) rather than duplicated 15 times.
  const EUROPASS_TEMPLATES = {
    aurora:   { layout: 'sidebar',  theme: 'aurora' },
    emerald:  { layout: 'sidebar',  theme: 'emerald' },
    slate:    { layout: 'sidebar',  theme: 'slate' },
    coral:    { layout: 'sidebar',  theme: 'coral' },
    ivory:    { layout: 'sidebar',  theme: 'ivory' },
    sunrise:  { layout: 'banner',   theme: 'sunrise' },
    horizon:  { layout: 'banner',   theme: 'horizon' },
    blossom:  { layout: 'banner',   theme: 'blossom' },
    nordic:   { layout: 'banner',   theme: 'nordic' },
    velvet:   { layout: 'banner',   theme: 'velvet' },
    pulse:    { layout: 'timeline', theme: 'pulse' },
    meridian: { layout: 'timeline', theme: 'meridian' },
    zenith:   { layout: 'timeline', theme: 'zenith' },
    canvas:   { layout: 'timeline', theme: 'canvas' },
    quartz:   { layout: 'timeline', theme: 'quartz' }
  };

  const cfg = EUROPASS_TEMPLATES[currentTemplate] || EUROPASS_TEMPLATES.aurora;

  const contactList = [
    personal.phoneno ? { icon: 'fa-phone', text: personal.phoneno } : null,
    personal.email ? { icon: 'fa-envelope', text: personal.email } : null,
    personal.address ? { icon: 'fa-location-dot', text: personal.address } : null,
    personal.website ? { icon: 'fa-globe', text: personal.website } : null
  ].filter(Boolean);

  const euItem = ({ title, sub, date, desc, link }) => `
    <div class="eu-item">
      <div class="eu-item-head">
        <strong>${title || ''}</strong>
        ${date ? `<span class="eu-date">${date}</span>` : ''}
      </div>
      ${sub ? `<div class="eu-item-sub">${sub}</div>` : ''}
      ${link ? `<a href="${link}" class="eu-link" target="_blank" rel="noopener">↗ ${link}</a>` : ''}
      ${desc ? `<p class="eu-item-desc">${desc.replace(/\n/g, '<br>')}</p>` : ''}
    </div>`;

  const expItems = experiences.filter(e => e.title || e.organization);
  const eduItems = educations.filter(e => e.school || e.degree);
  const projItems = projects.filter(p => p.title);
  const achItems = achievements.filter(a => a.title);

  const workExperienceHTML = expItems.length > 0 ? `
    <div class="eu-section">
      <h3><i class="fas fa-briefcase"></i> Work Experience</h3>
      ${expItems.map(e => euItem({
        title: e.title,
        sub: `${e.organization || ''}${e.location ? ', ' + e.location : ''}`,
        date: `${formatDate(e.startDate)} ${e.startDate ? '–' : ''} ${e.current ? 'Present' : formatDate(e.endDate)}`,
        desc: e.description
      })).join('')}
    </div>` : '';

  const educationHTML = eduItems.length > 0 ? `
    <div class="eu-section">
      <h3><i class="fas fa-graduation-cap"></i> Education and Training</h3>
      ${eduItems.map(e => euItem({
        title: e.degree,
        sub: `${e.school || ''}${e.city ? ', ' + e.city : ''}`,
        date: `${formatDate(e.startDate)} ${e.startDate ? '–' : ''} ${formatDate(e.endDate)}`,
        desc: e.description
      })).join('')}
    </div>` : '';

  const projectsHTML = projItems.length > 0 ? `
    <div class="eu-section">
      <h3><i class="fas fa-diagram-project"></i> Projects</h3>
      ${projItems.map(p => euItem({ title: p.title, link: p.link, desc: p.description })).join('')}
    </div>` : '';

  const achievementsHTML = achItems.length > 0 ? `
    <div class="eu-section">
      <h3><i class="fas fa-trophy"></i> Achievements</h3>
      ${achItems.map(a => euItem({ title: a.title, desc: a.description })).join('')}
    </div>` : '';

  // Europass-style language block: mother tongue(s) as a line, other
  // languages as a CEFR grid (Listening / Reading / Speaking / Writing).
  const motherTongues = languages.filter(l => l.language && l.mother);
  const otherLanguages = languages.filter(l => l.language && !l.mother);
  const languagesHTML = (motherTongues.length || otherLanguages.length) ? `
    <div class="eu-section">
      <h3><i class="fas fa-language"></i> Language Skills</h3>
      ${motherTongues.length ? `<p class="eu-lang-mother"><strong>Mother tongue(s):</strong> ${motherTongues.map(l => l.language).join(', ')}</p>` : ''}
      ${otherLanguages.length ? `
      <table class="eu-lang-table">
        <thead><tr><th scope="col">Other language(s)</th>${CEFR_SKILLS.map(s => `<th scope="col">${s.label}</th>`).join('')}</tr></thead>
        <tbody>${otherLanguages.map(l => `<tr><th scope="row">${l.language}</th>${CEFR_SKILLS.map(s => `<td>${l[s.key] || '–'}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>
      <p class="eu-lang-note">CEFR levels: A1–A2 basic user · B1–B2 independent user · C1–C2 proficient user</p>` : ''}
    </div>` : '';

  const customHTML = customSections.map(cs => cs.items.filter(i => i.title).length > 0 ? `
    <div class="eu-section">
      <h3><i class="fas fa-star"></i> ${cs.name}</h3>
      ${cs.items.filter(i => i.title).map(i => euItem({ title: i.title, desc: i.description })).join('')}
    </div>` : '').join('');

  const aboutMeHTML = personal.summary ? `
    <div class="eu-section">
      <h3><i class="fas fa-user"></i> About Me</h3>
      <p class="eu-about-text">${personal.summary}</p>
    </div>` : '';

  const skillsBarsHTML = skills.length > 0 ? `
    <div class="eu-section">
      <h3><i class="fas fa-layer-group"></i> Personal Skills</h3>
      ${skills.map(s => `
        <div class="eu-skill">
          <span>${s.skill}</span>
          <div class="eu-skill-bar"><div class="eu-skill-fill" style="width:${s.level}%"></div></div>
        </div>`).join('')}
    </div>` : '';

  const skillsTagsHTML = skills.length > 0 ? `
    <div class="eu-section">
      <h3><i class="fas fa-layer-group"></i> Personal Skills</h3>
      <div class="eu-skill-tags">${skills.map(s => `<span class="eu-skill-tag">${s.skill}</span>`).join('')}</div>
    </div>` : '';

  const contactHTML = contactList.map(c => `<div class="eu-contact-item"><i class="fas ${c.icon}"></i><span>${c.text}</span></div>`).join('');
  const contactInlineHTML = contactList.map(c => `<span class="eu-contact-inline"><i class="fas ${c.icon}"></i>${c.text}</span>`).join('');
  const photoHTML = personal.image ? `<img src="${personal.image}" class="eu-photo" alt="Photo">` : '<div class="eu-photo eu-photo-placeholder"><i class="fas fa-user"></i></div>';

  // ── LAYOUT: SIDEBAR (Aurora, Emerald, Slate, Coral, Ivory) ──
  if (cfg.layout === 'sidebar') {
    return `
      <div class="rv-eu rv-eu-sidebar theme-${cfg.theme}">
        <div class="eu-side">
          ${photoHTML}
          <h1>${fullName || 'Your Name'}</h1>
          <p class="eu-designation">${personal.designation || 'Your Title'}</p>
          <div class="eu-section eu-side-section">
            <h3><i class="fas fa-address-card"></i> Contact</h3>
            ${contactHTML}
          </div>
          ${skillsBarsHTML.replace('eu-section', 'eu-section eu-side-section')}
        </div>
        <div class="eu-main">
          ${aboutMeHTML}${workExperienceHTML}${educationHTML}${languagesHTML}${projectsHTML}${achievementsHTML}${customHTML}
        </div>
      </div>`;
  }

  // ── LAYOUT: BANNER (Sunrise, Horizon, Blossom, Nordic, Velvet) ──
  if (cfg.layout === 'banner') {
    return `
      <div class="rv-eu rv-eu-banner theme-${cfg.theme}">
        <div class="eu-banner">
          ${photoHTML}
          <div class="eu-banner-text">
            <h1>${fullName || 'Your Name'}</h1>
            <p class="eu-designation">${personal.designation || 'Your Title'}</p>
          </div>
        </div>
        <div class="eu-contact-bar">${contactInlineHTML}</div>
        <div class="eu-body">
          <div class="eu-main">
            ${aboutMeHTML}${workExperienceHTML}${projectsHTML}${languagesHTML}
          </div>
          <div class="eu-side-col">
            ${educationHTML}${skillsBarsHTML}${achievementsHTML}${customHTML}
          </div>
        </div>
      </div>`;
  }

  // ── LAYOUT: TIMELINE (Pulse, Meridian, Zenith, Canvas, Quartz) ──
  return `
    <div class="rv-eu rv-eu-timeline theme-${cfg.theme}">
      <div class="eu-tl-header">
        ${photoHTML}
        <div>
          <h1>${fullName || 'Your Name'}</h1>
          <p class="eu-designation">${personal.designation || 'Your Title'}</p>
          <div class="eu-contact-row">${contactInlineHTML}</div>
        </div>
      </div>
      ${aboutMeHTML}
      <div class="eu-tl-track">${workExperienceHTML}${educationHTML}</div>
      ${skillsTagsHTML}${languagesHTML}${projectsHTML}${achievementsHTML}${customHTML}
    </div>`;
}

// ── REPEATER ITEMS ─────────────────────────────────────
// Card header shared by experience / education / projects / achievements:
// drag handle, collapse toggle, a title that fills in from the fields
// (see updateItemLabel), and delete.
const repeaterHeader = (fallback) => `
      <div class="repeater-item-header">
        <span class="drag-handle" title="Drag to reorder"><i class="fas fa-grip-vertical"></i></span>
        <button type="button" class="item-toggle" onclick="toggleRepeaterItem(this)" aria-expanded="true" aria-label="Collapse"><i class="fas fa-chevron-down"></i></button>
        <span class="item-label" data-fallback="${fallback}">${fallback}</span>
        <button type="button" onclick="removeRepeaterItem(this)" class="remove-btn" aria-label="Delete"><i class="fas fa-trash-alt"></i></button>
      </div>`;

// Footer under a description box: tip on the left, AI button + counter on
// the right, and a slot where an AI suggestion appears.
const descMeta = (tip) => `
          <div class="field-meta"><span>${tip}</span><span class="meta-right">
            <button type="button" class="ai-improve-btn" onclick="improveDescription(this)"><i class="fas fa-wand-magic-sparkles" aria-hidden="true"></i> Improve with AI</button>
            <span class="char-count"></span></span></div>
          <div class="ai-suggest" aria-live="polite"></div>`;

// Common European Framework of Reference for Languages (CEFR), as used in
// the Europass CV's language self-assessment grid.
const CEFR_LEVELS = [
  { code: 'A1', name: 'Beginner' },
  { code: 'A2', name: 'Elementary' },
  { code: 'B1', name: 'Intermediate' },
  { code: 'B2', name: 'Upper intermediate' },
  { code: 'C1', name: 'Advanced' },
  { code: 'C2', name: 'Proficient' }
];
const CEFR_SKILLS = [
  { key: 'listening', label: 'Listening' },
  { key: 'reading', label: 'Reading' },
  { key: 'speaking', label: 'Speaking' },
  { key: 'writing', label: 'Writing' }
];

const SKILL_LEVELS = [
  { value: 25, label: 'Beginner' },
  { value: 50, label: 'Intermediate' },
  { value: 75, label: 'Advanced' },
  { value: 100, label: 'Expert' }
];

const repeaterTemplates = {
  experience: (id) => `
    <div class="repeater-item" data-id="${id}" data-section="experience">
      ${repeaterHeader('New experience')}
      <div class="form-row cols-3">
        <div class="form-elem"><label>Job Title</label>
          <input type="text" class="form-input exp_title" onkeyup="generateCV()" placeholder="e.g. Software Engineer"></div>
        <div class="form-elem"><label>Company</label>
          <input type="text" class="form-input exp_organization" onkeyup="generateCV()" placeholder="e.g. Google"></div>
        <div class="form-elem"><label>Location</label>
          <input type="text" class="form-input exp_location" onkeyup="generateCV()" placeholder="e.g. Remote"></div>
      </div>
      <div class="form-row cols-2">
        <div class="form-elem"><label>Start Date</label>
          <input type="month" class="form-input exp_start_date" onchange="generateCV()"></div>
        <div class="form-elem"><label>End Date</label>
          <input type="month" class="form-input exp_end_date" onchange="generateCV()">
          <label class="current-label"><input type="checkbox" class="exp_current" onchange="toggleCurrent(this)"> Currently working here</label></div>
      </div>
      <div class="form-row">
        <div class="form-elem"><label>Description</label>
          <textarea class="form-input exp_description" rows="3" data-count="500" onkeyup="generateCV()" placeholder="What you did and what changed because of it, e.g. Built a dashboard that cut report time by 40%"></textarea>
          ${descMeta('Tip: start with an action verb and show a result.')}</div>
      </div>
    </div>`,

  education: (id) => `
    <div class="repeater-item" data-id="${id}" data-section="education">
      ${repeaterHeader('New education')}
      <div class="form-row cols-3">
        <div class="form-elem"><label>School / University</label>
          <input type="text" class="form-input edu_school" onkeyup="generateCV()" placeholder="e.g. BUET"></div>
        <div class="form-elem"><label>Degree</label>
          <input type="text" class="form-input edu_degree" onkeyup="generateCV()" placeholder="e.g. B.Sc. in CSE"></div>
        <div class="form-elem"><label>City</label>
          <input type="text" class="form-input edu_city" onkeyup="generateCV()" placeholder="e.g. Dhaka"></div>
      </div>
      <div class="form-row cols-3">
        <div class="form-elem"><label>Start Date</label>
          <input type="month" class="form-input edu_start_date" onchange="generateCV()"></div>
        <div class="form-elem"><label>End / Graduation Date</label>
          <input type="month" class="form-input edu_graduation_date" onchange="generateCV()"></div>
        <div class="form-elem"><label>Description</label>
          <input type="text" class="form-input edu_description" onkeyup="generateCV()" placeholder="e.g. GPA 3.8/4.0"></div>
      </div>
    </div>`,

  // One compact row per skill: name + level buttons. The level is stored as
  // a number (25/50/75/100) in a hidden input, which the templates use as
  // the skill-bar width.
  skills: (id) => `
    <div class="repeater-item skill-item" data-id="${id}" data-section="skills">
      <span class="drag-handle" title="Drag to reorder"><i class="fas fa-grip-vertical"></i></span>
      <input type="text" class="form-input skill" onkeyup="generateCV()" placeholder="Skill, e.g. React.js" aria-label="Skill name">
      <input type="hidden" class="skill_level" value="75">
      <div class="skill-levels" role="group" aria-label="Skill level">
        ${SKILL_LEVELS.map(l => `<button type="button" data-level="${l.value}" aria-pressed="${l.value === 75}" class="${l.value === 75 ? 'active' : ''}" onclick="setSkillLevel(this)">${l.label}</button>`).join('')}
      </div>
      <button type="button" onclick="removeRepeaterItem(this)" class="remove-btn" aria-label="Delete skill"><i class="fas fa-trash-alt"></i></button>
    </div>`,

  projects: (id) => `
    <div class="repeater-item" data-id="${id}" data-section="projects">
      ${repeaterHeader('New project')}
      <div class="form-row cols-2">
        <div class="form-elem"><label>Project Name</label>
          <input type="text" class="form-input proj_title" onkeyup="generateCV()" placeholder="e.g. Resume Builder"></div>
        <div class="form-elem"><label>Project Link</label>
          <input type="url" class="form-input proj_link" onkeyup="generateCV()" placeholder="https://github.com/..."></div>
      </div>
      <div class="form-row">
        <div class="form-elem"><label>Description</label>
          <textarea class="form-input proj_description" rows="3" data-count="400" onkeyup="generateCV()" placeholder="What did you build, with what tech, and what was the result?"></textarea>
          ${descMeta('Tip: name the tech and one concrete outcome.')}</div>
      </div>
    </div>`,

  achievements: (id) => `
    <div class="repeater-item" data-id="${id}" data-section="achievements">
      ${repeaterHeader('New achievement')}
      <div class="form-row cols-2">
        <div class="form-elem"><label>Title</label>
          <input type="text" class="form-input achieve_title" onkeyup="generateCV()" placeholder="e.g. Dean's List 2023"></div>
        <div class="form-elem"><label>Description</label>
          <input type="text" class="form-input achieve_description" onkeyup="generateCV()" placeholder="Brief description..."></div>
      </div>
    </div>`,

  languages: (id) => `
    <div class="repeater-item lang-item" data-id="${id}" data-section="languages">
      ${repeaterHeader('New language')}
      <div class="form-row cols-2 lang-top">
        <div class="form-elem"><label>Language</label>
          <input type="text" class="form-input lang_name" onkeyup="generateCV()" placeholder="e.g. English"></div>
        <div class="form-elem lang-mother-elem">
          <label class="current-label lang-mother"><input type="checkbox" class="lang_mother" onchange="toggleMotherTongue(this)"> Mother tongue</label></div>
      </div>
      <div class="cefr-grid">
        ${CEFR_SKILLS.map(s => `
        <div class="form-elem"><label>${s.label}</label>
          <select class="form-input lang_${s.key}" onchange="generateCV()">
            <option value="">–</option>
            ${CEFR_LEVELS.map(l => `<option value="${l.code}">${l.code} · ${l.name}</option>`).join('')}
          </select></div>`).join('')}
      </div>
    </div>`
};

function toggleMotherTongue(checkbox) {
  const item = checkbox.closest('.repeater-item');
  item.classList.toggle('is-mother', checkbox.checked);
  updateItemLabel(item);
  generateCV();
}

let itemCounter = 0;
function addRepeaterItem(section, prefill = {}) {
  const container = document.getElementById(`${section}-container`);
  if (!container) return;

  const id = ++itemCounter;
  const html = repeaterTemplates[section](id);
  container.insertAdjacentHTML('beforeend', html);

  // Pre-fill values (e.g. from GitHub import)
  const newItem = container.lastElementChild;
  for (const [key, val] of Object.entries(prefill)) {
    const el = newItem.querySelector(`.${key}`);
    if (el) el.value = val;
  }
  refreshItemUI(newItem);

  generateCV();
}

// ── CARD HELPERS (titles, collapse, skill level, counters) ──
// Builds a card title from its own fields, e.g. "Software Engineer · Google".
function updateItemLabel(item) {
  const label = item?.querySelector('.item-label');
  if (!label) return;
  const v = cls => item.querySelector(`.${cls}`)?.value.trim() || '';
  const join = (...parts) => parts.filter(Boolean).join(' · ');
  const text = {
    experience: () => join(v('exp_title'), v('exp_organization')),
    education: () => join(v('edu_degree'), v('edu_school')),
    projects: () => v('proj_title'),
    achievements: () => v('achieve_title'),
    languages: () => {
      if (!v('lang_name')) return '';
      if (item.querySelector('.lang_mother')?.checked) return join(v('lang_name'), 'Mother tongue');
      const codes = CEFR_SKILLS.map(s => v(`lang_${s.key}`)).filter(Boolean).sort();
      const range = codes.length ? (codes[0] === codes[codes.length - 1] ? codes[0] : `${codes[0]}–${codes[codes.length - 1]}`) : '';
      return join(v('lang_name'), range);
    }
  }[item.dataset.section]?.() || '';
  label.textContent = text || label.dataset.fallback;
  label.classList.toggle('is-fallback', !text);
}

function toggleRepeaterItem(btn) {
  const item = btn.closest('.repeater-item');
  const collapsed = item.classList.toggle('collapsed');
  btn.setAttribute('aria-expanded', String(!collapsed));
  btn.setAttribute('aria-label', collapsed ? 'Expand' : 'Collapse');
}

// Highlights the level button closest to the stored number (old resumes
// may hold any value from the previous 10–100 slider).
function syncSkillLevel(item) {
  const input = item?.querySelector('.skill_level');
  if (!input) return;
  const value = Number(input.value) || 75;
  const nearest = SKILL_LEVELS.reduce((a, b) => Math.abs(b.value - value) < Math.abs(a.value - value) ? b : a).value;
  item.querySelectorAll('.skill-levels button').forEach(b => {
    const on = Number(b.dataset.level) === nearest;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
}

function setSkillLevel(btn) {
  const item = btn.closest('.repeater-item');
  item.querySelector('.skill_level').value = btn.dataset.level;
  syncSkillLevel(item);
  generateCV();
}

// "123 / 500" under text areas that carry data-count.
function updateCharCount(field) {
  const max = Number(field?.dataset.count);
  const counter = field?.closest('.form-elem')?.querySelector('.char-count');
  if (!max || !counter) return;
  const n = field.value.length;
  counter.textContent = `${n} / ${max}`;
  counter.classList.toggle('over', n > max);
}

function refreshItemUI(item) {
  const mother = item.querySelector('.lang_mother');
  if (mother) item.classList.toggle('is-mother', mother.checked);
  updateItemLabel(item);
  syncSkillLevel(item);
  item.querySelectorAll('[data-count]').forEach(updateCharCount);
}

// One listener keeps card titles and counters live while typing.
document.addEventListener('input', e => {
  const t = e.target;
  if (!(t instanceof HTMLElement)) return;
  if (t.dataset.count) updateCharCount(t);
  const item = t.closest('.repeater-item');
  if (item) updateItemLabel(item);
});
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-count]').forEach(updateCharCount);
});

function removeRepeaterItem(btn) {
  const item = btn.closest('.repeater-item');
  const wasSkill = item.dataset.section === 'skills';
  item.remove();
  if (wasSkill) updateSkillSuggestions();
  generateCV();
}

function toggleCurrent(checkbox) {
  const endDate = checkbox.closest('.form-elem').querySelector('.exp_end_date');
  if (endDate) endDate.disabled = checkbox.checked;
  generateCV();
}

// ── CUSTOM SECTIONS ────────────────────────────────────
let customSectionCounter = 0;

// Used by the "+ Add Section" buttons in the UI: creates a new custom
// section and seeds it with one blank item, same as the old behavior.
// (addCustomSection() itself stays a plain "create the section" building
// block so restoreCustomSections() can also drive it without double-adding
// items.)
function handleAddCustomSectionClick() {
  const id = addCustomSection();
  if (id) addCustomItem(id);
  generateCV();
}

function addCustomSection(defaultName = '') {
  const name = defaultName || prompt('Section name (e.g. Certifications, Languages, Volunteering):');
  if (!name) return;

  const id = ++customSectionCounter;
  const container = document.getElementById('custom-sections-container');
  const empty = document.getElementById('custom-empty');
  if (empty) empty.style.display = 'none';

  container.insertAdjacentHTML('beforeend', `
    <div class="form-section custom-section-block" data-cs-id="${id}">
      <div class="section-header">
        <div class="section-title-editable">
          <h3><i class="fas fa-layer-group"></i> <span class="custom-section-name" contenteditable="true" onblur="generateCV()">${escapeHTML(name)}</span></h3>
        </div>
        <div class="section-header-actions">
          <button onclick="addCustomItem(${id})" class="add-item-btn"><i class="fas fa-plus"></i> Add</button>
          <button onclick="removeCustomSection(${id})" class="remove-btn"><i class="fas fa-trash-alt"></i></button>
        </div>
      </div>
      <div class="custom-items-container" id="custom-items-${id}"></div>
      <button class="add-item-btn-secondary" onclick="addCustomItem(${id})"><i class="fas fa-plus"></i> Add Item</button>
    </div>
  `);

  return id;
}

function addCustomItem(sectionId, prefill = {}) {
  const container = document.getElementById(`custom-items-${sectionId}`);
  container.insertAdjacentHTML('beforeend', `
    <div class="repeater-item custom-item">
      <div class="repeater-item-header">
        <span class="item-label">Item</span>
        <button onclick="removeRepeaterItem(this)" class="remove-btn"><i class="fas fa-trash-alt"></i></button>
      </div>
      <div class="form-row cols-2">
        <div class="form-elem"><label>Title</label>
          <input type="text" class="form-input custom_title" onkeyup="generateCV()" placeholder="e.g. AWS Certified Developer"></div>
        <div class="form-elem"><label>Description</label>
          <input type="text" class="form-input custom_description" onkeyup="generateCV()" placeholder="e.g. Amazon Web Services, 2024"></div>
      </div>
    </div>
  `);

  const newItem = container.lastElementChild;
  if (prefill.title) newItem.querySelector('.custom_title').value = prefill.title;
  if (prefill.description) newItem.querySelector('.custom_description').value = prefill.description;

  generateCV();
}

function removeCustomSection(id) {
  document.querySelector(`[data-cs-id="${id}"]`)?.remove();
  const remaining = document.querySelectorAll('.custom-section-block');
  if (!remaining.length) {
    document.getElementById('custom-empty').style.display = 'flex';
  }
  generateCV();
}

// Rebuilds all custom sections (Certifications, Languages, etc.) from
// saved data. Previously only collectFormData() knew about these —
// restoreFromData() silently dropped them on reload/import.
function restoreCustomSections(customSectionsData) {
  const container = document.getElementById('custom-sections-container');
  if (!container) return;

  container.innerHTML = '';

  if (!customSectionsData?.length) {
    const empty = document.getElementById('custom-empty');
    if (empty) empty.style.display = 'flex';
    return;
  }

  customSectionsData.forEach(cs => {
    if (!cs.name) return;
    const id = addCustomSection(cs.name);
    (cs.items || []).forEach(item => {
      if (item.title || item.description) addCustomItem(id, item);
    });
    if (!cs.items?.length) addCustomItem(id); // keep one blank item like a freshly-added section
  });

  generateCV();
}

// ── QUICK-ADD CUSTOM SECTIONS ──────────────────────────
// One click adds a ready-named section with an example-shaped first item.
const SECTION_PRESETS = {
  Certifications: { title: 'e.g. AWS Certified Cloud Practitioner', description: 'e.g. Issuing organisation, 2024' },
  Volunteering: { title: 'e.g. Volunteer Teacher', description: 'e.g. Organisation, city, 2023' },
  Publications: { title: 'e.g. Paper or article title', description: 'e.g. Journal or conference, 2024' },
  Awards: { title: 'e.g. Best Final-Year Project', description: 'e.g. Awarded by, year' },
  Courses: { title: 'e.g. Machine Learning Specialization', description: 'e.g. Platform or institution, 2024' },
  Interests: { title: 'e.g. Photography', description: 'e.g. Street and travel photography' }
};

function addPresetSection(name) {
  const existing = [...document.querySelectorAll('.custom-section-block')]
    .find(b => b.querySelector('.custom-section-name')?.textContent.trim().toLowerCase() === name.toLowerCase());
  if (existing) {
    existing.scrollIntoView({ behavior: 'smooth', block: 'center' });
    showToast(`${name} is already added`, 'info');
    return;
  }
  const id = addCustomSection(name);
  addCustomItem(id);
  const block = document.querySelector(`[data-cs-id="${id}"]`);
  const preset = SECTION_PRESETS[name];
  if (block && preset) {
    block.querySelector('.custom_title').placeholder = preset.title;
    block.querySelector('.custom_description').placeholder = preset.description;
  }
  block?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  block?.querySelector('.custom_title')?.focus({ preventScroll: true });
}

// ── SKILL SUGGESTIONS ──────────────────────────────────
// Matches the job title against common roles and suggests skills that
// aren't on the resume yet. Runs fully in the browser, no AI call.
const SKILL_SUGGESTIONS = [
  { match: /front.?end|react|angular|vue|web dev|ui dev/i, skills: ['JavaScript', 'TypeScript', 'React', 'HTML & CSS', 'Next.js', 'Tailwind CSS', 'Accessibility (WCAG)', 'Git'] },
  { match: /back.?end|node|api|server|java\b|python dev|php|laravel|django/i, skills: ['Node.js', 'REST APIs', 'SQL', 'PostgreSQL', 'Docker', 'Authentication', 'Testing', 'Git'] },
  { match: /full.?stack|software|developer|programmer|coder/i, skills: ['JavaScript', 'TypeScript', 'React', 'Node.js', 'SQL', 'Git', 'Docker', 'Testing'] },
  { match: /data|analyst|scien|machine learning|\bml\b|\bai\b/i, skills: ['Python', 'SQL', 'Pandas', 'Machine Learning', 'Data Visualization', 'Statistics', 'Power BI', 'Excel'] },
  { match: /design|\bui\b|\bux\b/i, skills: ['Figma', 'UI Design', 'UX Research', 'Prototyping', 'Design Systems', 'Accessibility (WCAG)', 'User Testing'] },
  { match: /devops|cloud|sre|infrastructure/i, skills: ['Docker', 'Kubernetes', 'AWS', 'CI/CD', 'Linux', 'Terraform', 'Monitoring'] },
  { match: /mobile|android|ios|flutter/i, skills: ['Flutter', 'Kotlin', 'Swift', 'React Native', 'Firebase', 'REST APIs'] },
  { match: /market|seo|content|social media/i, skills: ['SEO', 'Content Marketing', 'Google Analytics', 'Social Media', 'Copywriting', 'Email Marketing'] }
];
const SOFT_SKILLS = ['Communication', 'Teamwork', 'Problem Solving', 'Time Management', 'Adaptability'];

function updateSkillSuggestions() {
  const box = document.getElementById('skillSuggest');
  if (!box) return;
  const title = document.querySelector('.designation')?.value.trim() || '';
  const have = new Set([...document.querySelectorAll('#skills-container .skill')].map(i => i.value.trim().toLowerCase()).filter(Boolean));
  const role = SKILL_SUGGESTIONS.find(r => r.match.test(title));
  const pool = role ? [...role.skills, ...SOFT_SKILLS.slice(0, 2)] : SOFT_SKILLS;
  const picks = pool.filter(s => !have.has(s.toLowerCase())).slice(0, 8);

  if (!picks.length) { box.innerHTML = ''; return; }
  const heading = title && role ? `Suggested for “${escapeHTML(title)}”:` : (title ? 'Suggested:' : 'Add your job title in Personal Info for tailored suggestions. Popular:');
  box.innerHTML = `<span class="quick-add-label">${heading}</span>` +
    picks.map(s => `<button type="button" class="chip" data-skill="${escapeHTML(s)}"><i class="fas fa-plus" aria-hidden="true"></i> ${escapeHTML(s)}</button>`).join('');
}

function addSuggestedSkill(name) {
  // Fill the first empty skill row if there is one, otherwise add a row.
  const empty = [...document.querySelectorAll('#skills-container .skill')].find(i => !i.value.trim());
  if (empty) { empty.value = name; refreshItemUI(empty.closest('.repeater-item')); generateCV(); }
  else addRepeaterItem('skills', { skill: name });
  updateSkillSuggestions();
}

document.addEventListener('click', e => {
  const chip = e.target.closest?.('#skillSuggest .chip');
  if (chip) addSuggestedSkill(chip.dataset.skill);
});
document.addEventListener('input', e => {
  if (e.target.matches?.('.designation, #skills-container .skill')) updateSkillSuggestions();
});
document.addEventListener('DOMContentLoaded', updateSkillSuggestions);

// ── DRAG & DROP SECTIONS ───────────────────────────────
function initSortableSections() {
  // Sort repeater items within containers
  ['experience', 'education', 'skills', 'projects', 'achievements', 'languages'].forEach(section => {
    const container = document.getElementById(`${section}-container`);
    if (container && typeof Sortable !== 'undefined') {
      Sortable.create(container, {
        handle: '.drag-handle',
        animation: 150,
        onEnd: generateCV
      });
    }
  });
}

// ── PROGRESS CALCULATOR ────────────────────────────────
function calculateProgress() {
  const checks = [
    document.querySelector('.firstname')?.value,
    document.querySelector('.lastname')?.value,
    document.querySelector('.designation')?.value,
    document.querySelector('.email')?.value,
    document.querySelector('.summary')?.value,
    document.querySelectorAll('#experience-container .exp_title').length > 0 &&
      document.querySelector('.exp_title')?.value,
    document.querySelectorAll('#education-container .edu_school').length > 0 &&
      document.querySelector('.edu_school')?.value,
    document.querySelectorAll('#skills-container .skill').length > 0 &&
      document.querySelector('.skill')?.value,
    document.querySelectorAll('#projects-container .proj_title').length > 0 &&
      document.querySelector('.proj_title')?.value,
  ];

  const filled = checks.filter(Boolean).length;
  const pct = Math.round((filled / checks.length) * 100);

  const fill = document.getElementById('progressFill');
  const label = document.getElementById('progressLabel');
  const sidebar = document.getElementById('sidebarProgress');

  if (fill) fill.style.width = pct + '%';
  if (label) label.textContent = pct + '% Complete';
  if (sidebar) sidebar.textContent = pct + '%';

  // Update step check marks
  updateStepChecks();
}

function updateStepChecks() {
  const steps = {
    personal: document.querySelector('.firstname')?.value || document.querySelector('.lastname')?.value,
    experience: document.querySelector('.exp_title')?.value,
    education: document.querySelector('.edu_school')?.value,
    skills: document.querySelector('.skill')?.value,
    projects: document.querySelector('.proj_title')?.value,
    achievements: document.querySelector('.achieve_title')?.value,
    languages: document.querySelector('.lang_name')?.value
  };

  for (const [step, filled] of Object.entries(steps)) {
    const stepEl = document.querySelector(`[data-step="${step}"]`);
    if (stepEl) {
      stepEl.classList.toggle('completed', !!filled);
    }
  }
}

// ── WIZARD NAVIGATION ──────────────────────────────────
// Highlights one sidebar step as the current one ("Now").
function setActiveStep(sectionId) {
  activeStep = sectionId;
  document.querySelectorAll('.step-item').forEach(s => {
    const on = s.dataset.step === sectionId;
    s.classList.toggle('active', on);
    if (on) s.setAttribute('aria-current', 'step');
    else s.removeAttribute('aria-current');
  });
}

// Set when a step is clicked, so the scroll-spy doesn't overrule the click
// while the smooth scroll is still moving (or when a short last section
// can't scroll all the way to the top).
let stepClickLockUntil = 0;

function scrollToSection(sectionId) {
  setActiveStep(sectionId);
  stepClickLockUntil = Date.now() + 900;

  // Scroll the form panel element to the target section
  const target = document.getElementById(`section-${sectionId}`);
  const formPanel = document.getElementById('formPanel');
  if (target && formPanel) {
    const extraPadding = 16;
    const scrollTop = formPanel.scrollTop + target.getBoundingClientRect().top - formPanel.getBoundingClientRect().top - extraPadding;
    formPanel.scrollTo({ top: scrollTop, behavior: 'smooth' });
  }
}

// ── SCROLL-SPY ─────────────────────────────────────────
// As the user scrolls the form, highlight the step for the section
// that is currently at the top of the panel.
function initStepScrollSpy() {
  const panel = document.getElementById('formPanel');
  const steps = [...document.querySelectorAll('.step-item[data-step]')];
  if (!panel || !steps.length) return;

  const sections = steps
    .map(s => ({ id: s.dataset.step, el: document.getElementById(`section-${s.dataset.step}`) }))
    .filter(s => s.el);

  let ticking = false;
  const update = () => {
    ticking = false;
    if (Date.now() < stepClickLockUntil) return;
    const panelTop = panel.getBoundingClientRect().top;
    let current = sections[0].id;
    for (const s of sections) {
      if (s.el.getBoundingClientRect().top - panelTop <= 120) current = s.id;
    }
    // At the very bottom, the last section may never reach the top line.
    if (panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 4) current = sections[sections.length - 1].id;
    if (current !== activeStep) setActiveStep(current);
  };

  // Throttle with a short timer (not requestAnimationFrame, which browsers
  // pause in background or hidden windows).
  panel.addEventListener('scroll', () => {
    if (!ticking) { ticking = true; setTimeout(update, 60); }
  }, { passive: true });
  update();
}

document.addEventListener('DOMContentLoaded', initStepScrollSpy);

// ── IMAGE PREVIEW ──────────────────────────────────────
function hasPhoto() {
  const src = document.getElementById('image_dsp')?.getAttribute('src');
  return !!src && src !== window.location.href;
}

// Shows the photo (or the placeholder icon) and the Remove button to match.
function syncPhotoUI() {
  const box = document.getElementById('photoUpload');
  if (!box) return;
  const on = hasPhoto();
  box.classList.toggle('has-photo', on);
  const text = box.querySelector('.photo-pick-text');
  if (text) text.textContent = on ? 'Change' : 'Upload';
}

function removePhoto() {
  const img = document.getElementById('image_dsp');
  if (img) img.removeAttribute('src');
  const input = document.getElementById('photoInput');
  if (input) input.value = '';
  syncPhotoUI();
  generateCV();
}

function previewImage() {
  const fileInput = document.querySelector('.image');
  handlePhotoFile(fileInput.files[0]);
}

function handlePhotoFile(file) {
  const fileInput = document.querySelector('.image');
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    showToast('❌ Please select an image file', 'error');
    if (fileInput) fileInput.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      // Downscale + compress to JPEG. A resume photo doesn't need to be
      // full camera resolution, and keeping it small avoids two real
      // problems: hitting localStorage's ~5MB quota, and making the
      // shareable link/QR code too big to generate.
      const MAX_DIMENSION = 400;
      const scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);

      document.getElementById('image_dsp').src = canvas.toDataURL('image/jpeg', 0.8);
      syncPhotoUI();
      generateCV();
    };
    img.onerror = () => showToast('❌ Could not read that image file', 'error');
    img.src = e.target.result;
  };
  reader.onerror = () => showToast('❌ Could not read that image file', 'error');
  reader.readAsDataURL(file);
}

// Drag-and-drop a photo onto the upload box.
function initPhotoDrop() {
  const box = document.getElementById('photoUpload');
  if (!box) return;
  ['dragenter', 'dragover'].forEach(ev => box.addEventListener(ev, e => {
    e.preventDefault(); box.classList.add('dragover');
  }));
  ['dragleave', 'drop'].forEach(ev => box.addEventListener(ev, e => {
    e.preventDefault(); box.classList.remove('dragover');
  }));
  box.addEventListener('drop', e => handlePhotoFile(e.dataTransfer?.files?.[0]));
  syncPhotoUI();
}
document.addEventListener('DOMContentLoaded', initPhotoDrop);

// ── JSON IMPORT / EXPORT ───────────────────────────────
function exportJSON() {
  const data = collectFormData();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `resume-${data.personal.firstname || 'taimur'}-${Date.now()}.json`;
  a.click();
  showToast('✅ Resume exported as JSON!', 'success');
}

function importJSON() {
  document.getElementById('jsonFileInput').click();
}

function loadJSONFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  // Let the same file be picked again later (onchange won't fire otherwise).
  event.target.value = '';
  if (file.size > 10 * 1024 * 1024) {
    showToast('❌ That file is too large to be a resume file (over 10 MB)', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    let obj;
    try {
      obj = JSON.parse(e.target.result);
    } catch (err) {
      showToast('❌ This file is not valid JSON', 'error');
      return;
    }
    // auth.js knows about accounts: it handles both a single exported
    // resume and the full "Download my data" backup.
    if (typeof handleImportedJSON === 'function') {
      handleImportedJSON(obj);
    } else if (obj && typeof obj.personal === 'object') {
      restoreFromData(obj);
      showToast('✅ Resume imported', 'success');
    } else {
      showToast('❌ This is not a Taimur Resume file', 'error');
    }
  };
  reader.readAsText(file);
}

// Maps each repeater section to the data key <-> CSS class pairs its
// fields use. One generic restore function (below) drives all of them,
// instead of five near-identical hand-written blocks.
const SECTION_FIELD_MAPS = {
  experience: [
    { data: 'title', cls: 'exp_title' },
    { data: 'organization', cls: 'exp_organization' },
    { data: 'location', cls: 'exp_location' },
    { data: 'startDate', cls: 'exp_start_date' },
    { data: 'endDate', cls: 'exp_end_date' },
    { data: 'current', cls: 'exp_current' },
    { data: 'description', cls: 'exp_description' }
  ],
  education: [
    { data: 'school', cls: 'edu_school' },
    { data: 'degree', cls: 'edu_degree' },
    { data: 'city', cls: 'edu_city' },
    { data: 'startDate', cls: 'edu_start_date' },
    { data: 'endDate', cls: 'edu_graduation_date' },
    { data: 'description', cls: 'edu_description' }
  ],
  skills: [
    { data: 'skill', cls: 'skill' },
    { data: 'level', cls: 'skill_level' }
  ],
  projects: [
    { data: 'title', cls: 'proj_title' },
    { data: 'link', cls: 'proj_link' },
    { data: 'description', cls: 'proj_description' }
  ],
  achievements: [
    { data: 'title', cls: 'achieve_title' },
    { data: 'description', cls: 'achieve_description' }
  ],
  languages: [
    { data: 'language', cls: 'lang_name' },
    { data: 'mother', cls: 'lang_mother' },
    { data: 'listening', cls: 'lang_listening' },
    { data: 'reading', cls: 'lang_reading' },
    { data: 'speaking', cls: 'lang_speaking' },
    { data: 'writing', cls: 'lang_writing' }
  ]
};

// Rebuilds one repeater section (experience/education/skills/projects/
// achievements) from saved data, using the field map above.
function restoreRepeaterSection(section, items, fieldMap) {
  const container = document.getElementById(`${section}-container`);
  if (!container) return;

  // Always clear first, even when this resume has no items for the
  // section — otherwise whatever the previously loaded resume put here
  // stays behind and shows up mixed in with the next resume.
  container.innerHTML = '';
  if (!items?.length) return;

  items.forEach(item => {
    addRepeaterItem(section);
    const newItem = container.lastElementChild;

    fieldMap.forEach(({ data: dataKey, cls }) => {
      const el = newItem.querySelector(`.${cls}`);
      if (!el) return;
      const value = item[dataKey];

      if (el.type === 'checkbox') {
        el.checked = !!value;
        return;
      }
      if (value === undefined || value === null || value === '') return;

      el.value = value;
    });
    refreshItemUI(newItem);

    // "Currently working here" should also disable the end-date field,
    // same as when a user checks it by hand (see toggleCurrent()).
    const currentCb = newItem.querySelector('.exp_current');
    if (currentCb?.checked) {
      const endDateEl = newItem.querySelector('.exp_end_date');
      if (endDateEl) endDateEl.disabled = true;
    }
  });
}

function restoreFromData(data) {
  if (!data) return;

  // Restore template. Each template sets its own accent colour in CSS,
  // so a "color" saved by older versions of the app is ignored.
  if (data.template) switchTemplate(data.template);

  // Restore personal fields — always set the field, even to empty, so a
  // blank field on the resume being loaded actually clears out whatever
  // the previously loaded resume left behind, instead of leaking through.
  const personal = data.personal || {};
  const setField = (cls, val) => {
    const el = document.querySelector(`.${cls}`);
    if (el) el.value = val || '';
  };
  setField('firstname', personal.firstname);
  setField('middlename', personal.middlename);
  setField('lastname', personal.lastname);
  setField('designation', personal.designation);
  setField('address', personal.address);
  setField('email', personal.email);
  setField('phoneno', personal.phoneno);
  setField('website', personal.website);
  setField('summary', personal.summary);
  document.querySelectorAll('.form-section > .form-row [data-count], #section-personal [data-count]').forEach(updateCharCount);

  // Same reasoning for the profile photo — clear it when the resume being
  // loaded doesn't have one, don't leave the previous resume's photo showing.
  const imageEl = document.getElementById('image_dsp');
  if (imageEl) {
    if (personal.image) imageEl.src = personal.image;
    else imageEl.removeAttribute('src');
  }
  syncPhotoUI();

  // Restore repeater sections
  restoreRepeaterSection('experience', data.experiences, SECTION_FIELD_MAPS.experience);
  restoreRepeaterSection('education', data.educations, SECTION_FIELD_MAPS.education);
  restoreRepeaterSection('skills', data.skills, SECTION_FIELD_MAPS.skills);
  restoreRepeaterSection('projects', data.projects, SECTION_FIELD_MAPS.projects);
  restoreRepeaterSection('achievements', data.achievements, SECTION_FIELD_MAPS.achievements);
  restoreRepeaterSection('languages', data.languages, SECTION_FIELD_MAPS.languages);
  updateSkillSuggestions();
  restoreCustomSections(data.customSections);

  generateCV();
}

// Local-storage auto-save was removed on purpose: it used to persist the
// whole resume in the browser regardless of sign-in state, so a second
// person on the same computer could open the site and see a previous
// visitor's data even after they signed out. Persistence now only ever
// happens in the cloud, tied to a signed-in account (see auth.js).

// ── PRINT ──────────────────────────────────────────────
function printCV() {
  window.print();
}

// ── TOAST NOTIFICATIONS ────────────────────────────────
function showToast(message, type = 'info') {
  const existing = document.getElementById('toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'toast';
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => toast.classList.add('toast-show'), 10);
  setTimeout(() => {
    toast.classList.remove('toast-show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}
