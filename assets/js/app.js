// ======================================================
// Taimur Rahman Resume Builder — Main App
// Features: Live Preview, 5 Templates, Drag & Drop,
//           Wizard, JSON Import/Export, Auto-Save,
//           Custom Sections, Progress Tracker
// ======================================================

'use strict';

// ── STATE ──────────────────────────────────────────────
let currentTemplate = 'modern';
let currentColor = '#2a9e77';
let customSections = [];
let sectionOrder = ['experience', 'education', 'skills', 'projects', 'achievements'];
let activeStep = 'personal';

// ── INIT ───────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadFromLocalStorage();
  initSortableSections();
  addInitialItems();
  generateCV();
  calculateProgress();
});

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
  saveToLocalStorage();
}

function updateColor(color) {
  currentColor = color;
  document.getElementById('resumePreview').style.setProperty('--resume-accent', color);
  generateCV();
  saveToLocalStorage();
}

// ── GENERATE CV (LIVE PREVIEW) ─────────────────────────
function generateCV() {
  const data = collectFormData();
  const preview = document.getElementById('resumePreview');
  const empty = document.getElementById('previewEmpty');

  const hasData = data.personal.firstname || data.personal.lastname || data.personal.designation;

  if (!hasData) {
    if (empty) empty.style.display = 'flex';
    return;
  }

  if (empty) empty.style.display = 'none';

  preview.style.setProperty('--resume-accent', currentColor);
  preview.innerHTML = buildResumeHTML(data);

  calculateProgress();
  saveToLocalStorage();
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
  const imageSrc = imageEl?.src && imageEl.src !== window.location.href ? imageEl.src : '';

  return {
    template: currentTemplate,
    color: currentColor,
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
    customSections: customs
  };
}

// ── RESUME HTML BUILDER ────────────────────────────────
function buildResumeHTML(data) {
  const { personal, experiences, educations, skills, projects, achievements, customSections } = data;

  const fullName = [personal.firstname, personal.middlename, personal.lastname].filter(Boolean).join(' ');
  const formatDate = (d) => {
    if (!d) return '';
    const [y, m] = d.split('-');
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return months[parseInt(m) - 1] + ' ' + y;
  };

  // ---- MODERN TEMPLATE ----
  if (currentTemplate === 'modern' || currentTemplate === 'creative') {
    return `
      <div class="rv-modern">
        <div class="rv-left">
          ${personal.image ? `<div class="rv-photo"><img src="${personal.image}" alt="Photo"></div>` : ''}
          <div class="rv-name-block">
            <h1>${fullName || 'Your Name'}</h1>
            <p class="rv-designation">${personal.designation || 'Your Title'}</p>
          </div>
          <div class="rv-section">
            <h3>CONTACT</h3>
            ${personal.phoneno ? `<div class="rv-contact-item">📞 ${personal.phoneno}</div>` : ''}
            ${personal.email ? `<div class="rv-contact-item">✉️ ${personal.email}</div>` : ''}
            ${personal.address ? `<div class="rv-contact-item">📍 ${personal.address}</div>` : ''}
            ${personal.website ? `<div class="rv-contact-item">🌐 ${personal.website}</div>` : ''}
          </div>
          ${skills.length > 0 ? `
          <div class="rv-section">
            <h3>SKILLS</h3>
            ${skills.map(s => `
              <div class="rv-skill">
                <span>${s.skill}</span>
                <div class="rv-skill-bar"><div class="rv-skill-fill" style="width:${s.level}%"></div></div>
              </div>`).join('')}
          </div>` : ''}
        </div>
        <div class="rv-right">
          ${personal.summary ? `
          <div class="rv-section">
            <h3>PROFILE</h3>
            <p>${personal.summary}</p>
          </div>` : ''}
          ${experiences.filter(e => e.title || e.organization).length > 0 ? `
          <div class="rv-section">
            <h3>EXPERIENCE</h3>
            ${experiences.filter(e => e.title || e.organization).map(e => `
              <div class="rv-item">
                <div class="rv-item-header">
                  <strong>${e.title}</strong>
                  <span class="rv-date">${formatDate(e.startDate)} ${e.startDate ? '–' : ''} ${e.current ? 'Present' : formatDate(e.endDate)}</span>
                </div>
                <div class="rv-item-sub">${e.organization}${e.location ? ', ' + e.location : ''}</div>
                ${e.description ? `<p class="rv-item-desc">${e.description}</p>` : ''}
              </div>`).join('')}
          </div>` : ''}
          ${educations.filter(e => e.school || e.degree).length > 0 ? `
          <div class="rv-section">
            <h3>EDUCATION</h3>
            ${educations.filter(e => e.school || e.degree).map(e => `
              <div class="rv-item">
                <div class="rv-item-header">
                  <strong>${e.degree}</strong>
                  <span class="rv-date">${formatDate(e.startDate)} ${e.startDate ? '–' : ''} ${formatDate(e.endDate)}</span>
                </div>
                <div class="rv-item-sub">${e.school}${e.city ? ', ' + e.city : ''}</div>
                ${e.description ? `<p class="rv-item-desc">${e.description}</p>` : ''}
              </div>`).join('')}
          </div>` : ''}
          ${projects.filter(p => p.title).length > 0 ? `
          <div class="rv-section">
            <h3>PROJECTS</h3>
            ${projects.filter(p => p.title).map(p => `
              <div class="rv-item">
                <div class="rv-item-header">
                  <strong>${p.title}</strong>
                  ${p.link ? `<a href="${p.link}" class="rv-link" target="_blank">↗ Link</a>` : ''}
                </div>
                ${p.description ? `<p class="rv-item-desc">${p.description}</p>` : ''}
              </div>`).join('')}
          </div>` : ''}
          ${achievements.filter(a => a.title).length > 0 ? `
          <div class="rv-section">
            <h3>ACHIEVEMENTS</h3>
            ${achievements.filter(a => a.title).map(a => `
              <div class="rv-item">
                <strong>${a.title}</strong>
                ${a.description ? `<p class="rv-item-desc">${a.description}</p>` : ''}
              </div>`).join('')}
          </div>` : ''}
          ${customSections.map(cs => cs.items.filter(i => i.title).length > 0 ? `
          <div class="rv-section">
            <h3>${cs.name.toUpperCase()}</h3>
            ${cs.items.filter(i => i.title).map(i => `
              <div class="rv-item">
                <strong>${i.title}</strong>
                ${i.description ? `<p class="rv-item-desc">${i.description}</p>` : ''}
              </div>`).join('')}
          </div>` : '').join('')}
        </div>
      </div>`;
  }

  // ---- CLASSIC TEMPLATE ----
  if (currentTemplate === 'classic') {
    return `
      <div class="rv-classic">
        <div class="rv-classic-header">
          ${personal.image ? `<img src="${personal.image}" class="rv-classic-photo" alt="Photo">` : ''}
          <div>
            <h1>${fullName || 'Your Name'}</h1>
            <p class="rv-classic-title">${personal.designation || ''}</p>
            <div class="rv-classic-contacts">
              ${[personal.email, personal.phoneno, personal.address, personal.website].filter(Boolean).join(' · ')}
            </div>
          </div>
        </div>
        ${personal.summary ? `<div class="rv-classic-section"><p class="rv-classic-summary">${personal.summary}</p></div>` : ''}
        ${experiences.filter(e => e.title).length > 0 ? `
        <div class="rv-classic-section">
          <h3>WORK EXPERIENCE</h3><hr>
          ${experiences.filter(e => e.title).map(e => `
            <div class="rv-classic-item">
              <div class="rv-classic-item-top">
                <span><strong>${e.title}</strong> — ${e.organization}</span>
                <span class="rv-classic-date">${formatDate(e.startDate)} – ${e.current ? 'Present' : formatDate(e.endDate)}</span>
              </div>
              ${e.location ? `<div class="rv-classic-sub">${e.location}</div>` : ''}
              ${e.description ? `<p>${e.description}</p>` : ''}
            </div>`).join('')}
        </div>` : ''}
        ${educations.filter(e => e.school).length > 0 ? `
        <div class="rv-classic-section">
          <h3>EDUCATION</h3><hr>
          ${educations.filter(e => e.school).map(e => `
            <div class="rv-classic-item">
              <div class="rv-classic-item-top">
                <span><strong>${e.degree}</strong> — ${e.school}</span>
                <span class="rv-classic-date">${formatDate(e.startDate)} – ${formatDate(e.endDate)}</span>
              </div>
            </div>`).join('')}
        </div>` : ''}
        ${skills.length > 0 ? `
        <div class="rv-classic-section">
          <h3>SKILLS</h3><hr>
          <p>${skills.map(s => s.skill).join(' · ')}</p>
        </div>` : ''}
        ${projects.filter(p => p.title).length > 0 ? `
        <div class="rv-classic-section">
          <h3>PROJECTS</h3><hr>
          ${projects.filter(p => p.title).map(p => `
            <div class="rv-classic-item">
              <strong>${p.title}</strong>${p.link ? ` — <a href="${p.link}">${p.link}</a>` : ''}
              ${p.description ? `<p>${p.description}</p>` : ''}
            </div>`).join('')}
        </div>` : ''}
        ${achievements.filter(a => a.title).length > 0 ? `
        <div class="rv-classic-section">
          <h3>ACHIEVEMENTS</h3><hr>
          ${achievements.filter(a => a.title).map(a => `
            <div class="rv-classic-item"><strong>${a.title}</strong> — ${a.description}</div>`).join('')}
        </div>` : ''}
      </div>`;
  }

  // ---- MINIMAL TEMPLATE ----
  if (currentTemplate === 'minimal') {
    return `
      <div class="rv-minimal">
        <div class="rv-minimal-header">
          <h1>${fullName || 'Your Name'}</h1>
          <div class="rv-minimal-sub">
            ${personal.designation ? `<span>${personal.designation}</span>` : ''}
            ${personal.email ? `<span>${personal.email}</span>` : ''}
            ${personal.phoneno ? `<span>${personal.phoneno}</span>` : ''}
          </div>
        </div>
        ${personal.summary ? `<p class="rv-minimal-summary">${personal.summary}</p>` : ''}
        ${experiences.filter(e => e.title).length > 0 ? `
        <div class="rv-minimal-section">
          <h3>Experience</h3>
          ${experiences.filter(e => e.title).map(e => `
            <div class="rv-minimal-item">
              <div class="rv-minimal-row">
                <strong>${e.title}, ${e.organization}</strong>
                <span>${formatDate(e.startDate)} – ${e.current ? 'Present' : formatDate(e.endDate)}</span>
              </div>
              ${e.description ? `<p>${e.description}</p>` : ''}
            </div>`).join('')}
        </div>` : ''}
        ${educations.filter(e => e.school).length > 0 ? `
        <div class="rv-minimal-section">
          <h3>Education</h3>
          ${educations.filter(e => e.school).map(e => `
            <div class="rv-minimal-item">
              <div class="rv-minimal-row">
                <strong>${e.degree}</strong>
                <span>${formatDate(e.startDate)} – ${formatDate(e.endDate)}</span>
              </div>
              <span class="rv-minimal-dim">${e.school}</span>
            </div>`).join('')}
        </div>` : ''}
        ${skills.length > 0 ? `
        <div class="rv-minimal-section">
          <h3>Skills</h3>
          <div class="rv-minimal-skills">${skills.map(s => `<span class="rv-minimal-skill-tag">${s.skill}</span>`).join('')}</div>
        </div>` : ''}
        ${projects.filter(p => p.title).length > 0 ? `
        <div class="rv-minimal-section">
          <h3>Projects</h3>
          ${projects.filter(p => p.title).map(p => `
            <div class="rv-minimal-item">
              <strong>${p.title}</strong>${p.link ? ` <a href="${p.link}" class="rv-link" target="_blank">↗</a>` : ''}
              ${p.description ? `<p>${p.description}</p>` : ''}
            </div>`).join('')}
        </div>` : ''}
        ${achievements.filter(a => a.title).length > 0 ? `
        <div class="rv-minimal-section">
          <h3>Achievements</h3>
          ${achievements.filter(a => a.title).map(a => `<div class="rv-minimal-item"><strong>${a.title}</strong> — ${a.description}</div>`).join('')}
        </div>` : ''}
      </div>`;
  }

  // ---- PROFESSIONAL TEMPLATE ----
  if (currentTemplate === 'professional') {
    return `
      <div class="rv-professional">
        <div class="rv-pro-header">
          ${personal.image ? `<img src="${personal.image}" class="rv-pro-photo" alt="Photo">` : ''}
          <div class="rv-pro-header-text">
            <h1>${fullName || 'Your Name'}</h1>
            <h2>${personal.designation || ''}</h2>
          </div>
        </div>
        <div class="rv-pro-contact-bar">
          ${[
            personal.email ? `✉ ${personal.email}` : '',
            personal.phoneno ? `☎ ${personal.phoneno}` : '',
            personal.address ? `⊙ ${personal.address}` : '',
            personal.website ? `⊕ ${personal.website}` : ''
          ].filter(Boolean).join('  |  ')}
        </div>
        <div class="rv-pro-body">
          <div class="rv-pro-main">
            ${personal.summary ? `
            <div class="rv-pro-section">
              <h3>PROFESSIONAL SUMMARY</h3>
              <p>${personal.summary}</p>
            </div>` : ''}
            ${experiences.filter(e => e.title).length > 0 ? `
            <div class="rv-pro-section">
              <h3>WORK EXPERIENCE</h3>
              ${experiences.filter(e => e.title).map(e => `
                <div class="rv-pro-item">
                  <div class="rv-pro-item-title">
                    <strong>${e.title}</strong>
                    <span>${formatDate(e.startDate)} – ${e.current ? 'Present' : formatDate(e.endDate)}</span>
                  </div>
                  <div class="rv-pro-item-sub">${e.organization}${e.location ? ' · ' + e.location : ''}</div>
                  ${e.description ? `<p>${e.description}</p>` : ''}
                </div>`).join('')}
            </div>` : ''}
            ${projects.filter(p => p.title).length > 0 ? `
            <div class="rv-pro-section">
              <h3>PROJECTS</h3>
              ${projects.filter(p => p.title).map(p => `
                <div class="rv-pro-item">
                  <strong>${p.title}</strong>${p.link ? ` — <a href="${p.link}" class="rv-link">${p.link}</a>` : ''}
                  ${p.description ? `<p>${p.description}</p>` : ''}
                </div>`).join('')}
            </div>` : ''}
          </div>
          <div class="rv-pro-sidebar">
            ${educations.filter(e => e.school).length > 0 ? `
            <div class="rv-pro-section">
              <h3>EDUCATION</h3>
              ${educations.filter(e => e.school).map(e => `
                <div class="rv-pro-item">
                  <strong>${e.degree}</strong>
                  <div>${e.school}</div>
                  <div class="rv-pro-date">${formatDate(e.startDate)} – ${formatDate(e.endDate)}</div>
                </div>`).join('')}
            </div>` : ''}
            ${skills.length > 0 ? `
            <div class="rv-pro-section">
              <h3>SKILLS</h3>
              ${skills.map(s => `
                <div class="rv-pro-skill">
                  <span>${s.skill}</span>
                  <div class="rv-pro-skill-bar"><div style="width:${s.level}%"></div></div>
                </div>`).join('')}
            </div>` : ''}
            ${achievements.filter(a => a.title).length > 0 ? `
            <div class="rv-pro-section">
              <h3>ACHIEVEMENTS</h3>
              ${achievements.filter(a => a.title).map(a => `
                <div class="rv-pro-item">• <strong>${a.title}</strong>${a.description ? ': ' + a.description : ''}</div>`).join('')}
            </div>` : ''}
          </div>
        </div>
      </div>`;
  }

  return '<div style="padding:20px;color:#666">Select a template above</div>';
}

// ── REPEATER ITEMS ─────────────────────────────────────
const repeaterTemplates = {
  experience: (id) => `
    <div class="repeater-item" data-id="${id}">
      <div class="repeater-item-header">
        <span class="drag-handle"><i class="fas fa-grip-vertical"></i></span>
        <span class="item-label">Experience</span>
        <button onclick="removeRepeaterItem(this)" class="remove-btn"><i class="fas fa-trash-alt"></i></button>
      </div>
      <div class="form-row cols-3">
        <div class="form-elem"><label>Job Title</label>
          <input type="text" class="form-input exp_title" onkeyup="generateCV()" placeholder="e.g. Software Engineer"></div>
        <div class="form-elem"><label>Company</label>
          <input type="text" class="form-input exp_organization" onkeyup="generateCV()" placeholder="e.g. Google"></div>
        <div class="form-elem"><label>Location</label>
          <input type="text" class="form-input exp_location" onkeyup="generateCV()" placeholder="e.g. Remote"></div>
      </div>
      <div class="form-row cols-3">
        <div class="form-elem"><label>Start Date</label>
          <input type="month" class="form-input exp_start_date" onchange="generateCV()"></div>
        <div class="form-elem"><label>End Date</label>
          <input type="month" class="form-input exp_end_date" onchange="generateCV()">
          <label class="current-label"><input type="checkbox" class="exp_current" onchange="toggleCurrent(this)"> Currently working here</label></div>
        <div class="form-elem"><label>Description</label>
          <textarea class="form-input exp_description" rows="2" onkeyup="generateCV()" placeholder="Key responsibilities and achievements..."></textarea></div>
      </div>
    </div>`,

  education: (id) => `
    <div class="repeater-item" data-id="${id}">
      <div class="repeater-item-header">
        <span class="drag-handle"><i class="fas fa-grip-vertical"></i></span>
        <span class="item-label">Education</span>
        <button onclick="removeRepeaterItem(this)" class="remove-btn"><i class="fas fa-trash-alt"></i></button>
      </div>
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

  skills: (id) => `
    <div class="repeater-item" data-id="${id}">
      <div class="repeater-item-header">
        <span class="drag-handle"><i class="fas fa-grip-vertical"></i></span>
        <span class="item-label">Skill</span>
        <button onclick="removeRepeaterItem(this)" class="remove-btn"><i class="fas fa-trash-alt"></i></button>
      </div>
      <div class="form-row cols-2">
        <div class="form-elem"><label>Skill Name</label>
          <input type="text" class="form-input skill" onkeyup="generateCV()" placeholder="e.g. React.js"></div>
        <div class="form-elem"><label>Proficiency: <span class="skill-pct">80</span>%</label>
          <input type="range" class="form-input skill_level" min="10" max="100" value="80"
            oninput="this.previousElementSibling.querySelector('.skill-pct').textContent=this.value; generateCV()"></div>
      </div>
    </div>`,

  projects: (id) => `
    <div class="repeater-item" data-id="${id}">
      <div class="repeater-item-header">
        <span class="drag-handle"><i class="fas fa-grip-vertical"></i></span>
        <span class="item-label">Project</span>
        <button onclick="removeRepeaterItem(this)" class="remove-btn"><i class="fas fa-trash-alt"></i></button>
      </div>
      <div class="form-row cols-3">
        <div class="form-elem"><label>Project Name</label>
          <input type="text" class="form-input proj_title" onkeyup="generateCV()" placeholder="e.g. Resume Builder"></div>
        <div class="form-elem"><label>Project Link</label>
          <input type="url" class="form-input proj_link" onkeyup="generateCV()" placeholder="https://github.com/..."></div>
        <div class="form-elem"><label>Description</label>
          <textarea class="form-input proj_description" rows="2" onkeyup="generateCV()" placeholder="What did you build and with what tech?"></textarea></div>
      </div>
    </div>`,

  achievements: (id) => `
    <div class="repeater-item" data-id="${id}">
      <div class="repeater-item-header">
        <span class="drag-handle"><i class="fas fa-grip-vertical"></i></span>
        <span class="item-label">Achievement</span>
        <button onclick="removeRepeaterItem(this)" class="remove-btn"><i class="fas fa-trash-alt"></i></button>
      </div>
      <div class="form-row cols-2">
        <div class="form-elem"><label>Title</label>
          <input type="text" class="form-input achieve_title" onkeyup="generateCV()" placeholder="e.g. Dean's List 2023"></div>
        <div class="form-elem"><label>Description</label>
          <input type="text" class="form-input achieve_description" onkeyup="generateCV()" placeholder="Brief description..."></div>
      </div>
    </div>`
};

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

  generateCV();
}

function removeRepeaterItem(btn) {
  btn.closest('.repeater-item').remove();
  generateCV();
}

function toggleCurrent(checkbox) {
  const endDate = checkbox.closest('.form-elem').previousElementSibling.querySelector('.exp_end_date');
  if (endDate) endDate.disabled = checkbox.checked;
  generateCV();
}

// ── CUSTOM SECTIONS ────────────────────────────────────
let customSectionCounter = 0;

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
          <h3><i class="fas fa-layer-group"></i> <span class="custom-section-name" contenteditable="true" onblur="generateCV()">${name}</span></h3>
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

  addCustomItem(id);
  generateCV();
}

function addCustomItem(sectionId) {
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

// ── DRAG & DROP SECTIONS ───────────────────────────────
function initSortableSections() {
  // Sort repeater items within containers
  ['experience', 'education', 'skills', 'projects', 'achievements'].forEach(section => {
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
    achievements: document.querySelector('.achieve_title')?.value
  };

  for (const [step, filled] of Object.entries(steps)) {
    const stepEl = document.querySelector(`[data-step="${step}"]`);
    if (stepEl) {
      stepEl.classList.toggle('completed', !!filled);
    }
  }
}

// ── WIZARD NAVIGATION ──────────────────────────────────
function scrollToSection(sectionId) {
  activeStep = sectionId;

  // Update active step in sidebar
  document.querySelectorAll('.step-item').forEach(s => s.classList.remove('active'));
  const activeEl = document.querySelector(`[data-step="${sectionId}"]`);
  if (activeEl) activeEl.classList.add('active');

  // Scroll the form panel element to the target section
  const target = document.getElementById(`section-${sectionId}`);
  const formPanel = document.getElementById('formPanel');
  if (target && formPanel) {
    const extraPadding = 16;
    const scrollTop = formPanel.scrollTop + target.getBoundingClientRect().top - formPanel.getBoundingClientRect().top - extraPadding;
    formPanel.scrollTo({ top: scrollTop, behavior: 'smooth' });
  }
}

// ── IMAGE PREVIEW ──────────────────────────────────────
function previewImage() {
  const file = document.querySelector('.image').files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    document.getElementById('image_dsp').src = e.target.result;
    generateCV();
  };
  reader.readAsDataURL(file);
}

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
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      restoreFromData(data);
      showToast('✅ Resume imported successfully!', 'success');
    } catch (err) {
      showToast('❌ Invalid JSON file', 'error');
    }
  };
  reader.readAsText(file);
}

function restoreFromData(data) {
  if (!data) return;

  // Restore template & color
  if (data.template) switchTemplate(data.template);
  if (data.color) {
    currentColor = data.color;
    document.getElementById('colorPicker').value = data.color;
  }

  // Restore personal fields
  const personal = data.personal || {};
  const setField = (cls, val) => {
    const el = document.querySelector(`.${cls}`);
    if (el && val) el.value = val;
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

  // Restore repeater sections
  const restoreRepeater = (section, items, fields) => {
    const container = document.getElementById(`${section}-container`);
    if (!container || !items?.length) return;
    container.innerHTML = '';
    items.forEach(item => {
      addRepeaterItem(section);
      const newItem = container.lastElementChild;
      fields.forEach(f => {
        const el = newItem.querySelector(`.${f}`);
        if (el) el.value = item[f.replace(/^(exp_|edu_|proj_|achieve_|skill)/, '')] || item[f] || '';
      });
    });
  };

  if (data.experiences) {
    document.getElementById('experience-container').innerHTML = '';
    data.experiences.forEach(exp => {
      addRepeaterItem('experience');
      const c = document.getElementById('experience-container');
      const item = c.lastElementChild;
      item.querySelector('.exp_title').value = exp.title || '';
      item.querySelector('.exp_organization').value = exp.organization || '';
      item.querySelector('.exp_location').value = exp.location || '';
      item.querySelector('.exp_start_date').value = exp.startDate || '';
      item.querySelector('.exp_end_date').value = exp.endDate || '';
      item.querySelector('.exp_description').value = exp.description || '';
    });
  }

  if (data.educations) {
    document.getElementById('education-container').innerHTML = '';
    data.educations.forEach(edu => {
      addRepeaterItem('education');
      const c = document.getElementById('education-container');
      const item = c.lastElementChild;
      item.querySelector('.edu_school').value = edu.school || '';
      item.querySelector('.edu_degree').value = edu.degree || '';
      item.querySelector('.edu_city').value = edu.city || '';
      item.querySelector('.edu_start_date').value = edu.startDate || '';
      item.querySelector('.edu_graduation_date').value = edu.endDate || '';
      item.querySelector('.edu_description').value = edu.description || '';
    });
  }

  if (data.skills) {
    document.getElementById('skills-container').innerHTML = '';
    data.skills.forEach(s => {
      addRepeaterItem('skills');
      const c = document.getElementById('skills-container');
      const item = c.lastElementChild;
      item.querySelector('.skill').value = s.skill || '';
      const slider = item.querySelector('.skill_level');
      if (slider) {
        slider.value = s.level || 80;
        slider.previousElementSibling.querySelector('.skill-pct').textContent = s.level || 80;
      }
    });
  }

  if (data.projects) {
    document.getElementById('projects-container').innerHTML = '';
    data.projects.forEach(p => {
      addRepeaterItem('projects');
      const c = document.getElementById('projects-container');
      const item = c.lastElementChild;
      item.querySelector('.proj_title').value = p.title || '';
      item.querySelector('.proj_link').value = p.link || '';
      item.querySelector('.proj_description').value = p.description || '';
    });
  }

  if (data.achievements) {
    document.getElementById('achievements-container').innerHTML = '';
    data.achievements.forEach(a => {
      addRepeaterItem('achievements');
      const c = document.getElementById('achievements-container');
      const item = c.lastElementChild;
      item.querySelector('.achieve_title').value = a.title || '';
      item.querySelector('.achieve_description').value = a.description || '';
    });
  }

  generateCV();
}

// ── LOCAL STORAGE ──────────────────────────────────────
function saveToLocalStorage() {
  try {
    const data = collectFormData();
    localStorage.setItem('tr_resume_data', JSON.stringify(data));
  } catch (e) {}
}

function loadFromLocalStorage() {
  try {
    const saved = localStorage.getItem('tr_resume_data');
    if (saved) {
      const data = JSON.parse(saved);
      restoreFromData(data);
    }
  } catch (e) {}
}

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
