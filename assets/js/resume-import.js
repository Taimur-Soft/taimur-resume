// ======================================================
// Import a resume from PDF or Word (.docx)
// 1. Read the text in the browser (pdf.js / mammoth.js, loaded only when
//    needed, so the page stays light).
// 2. Gemini sorts that text into the builder's fields, using only what
//    the file says.
// 3. Show what was found, then open it (as a new saved resume when the
//    user is signed in — see openImportedResume in auth.js).
// JSON files are handled by handleImportedJSON in auth.js.
// ======================================================

const IMPORT_LIBS = {
  pdf: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  pdfWorker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  docx: 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js'
};
const IMPORT_MAX_BYTES = 10 * 1024 * 1024;
const IMPORT_MAX_TEXT = 12000; // enough for a long CV, inside the AI request limit

const loadedScripts = {};
function loadScriptOnce(src) {
  if (!loadedScripts[src]) {
    loadedScripts[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = resolve;
      s.onerror = () => { delete loadedScripts[src]; reject(new Error('Could not load the file reader. Check your internet connection.')); };
      document.head.appendChild(s);
    });
  }
  return loadedScripts[src];
}

function fileKind(file) {
  const name = (file.name || '').toLowerCase();
  if (name.endsWith('.json') || file.type === 'application/json') return 'json';
  if (name.endsWith('.pdf') || file.type === 'application/pdf') return 'pdf';
  if (name.endsWith('.docx') || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
  if (name.endsWith('.doc')) return 'doc';
  return 'other';
}

async function readPdfText(file) {
  await loadScriptOnce(IMPORT_LIBS.pdf);
  const pdfjs = window.pdfjsLib;
  pdfjs.GlobalWorkerOptions.workerSrc = IMPORT_LIBS.pdfWorker;
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  for (let n = 1; n <= Math.min(pdf.numPages, 10); n++) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    // Keep line breaks: a new line starts where the text jumps down.
    let lastY = null;
    let line = '';
    const lines = [];
    for (const item of content.items) {
      const y = item.transform?.[5];
      if (lastY !== null && Math.abs(y - lastY) > 2) { lines.push(line); line = ''; }
      line += (line && !line.endsWith(' ') && !item.str.startsWith(' ') ? ' ' : '') + item.str;
      lastY = y;
    }
    lines.push(line);
    pages.push(lines.map(l => l.trim()).filter(Boolean).join('\n'));
  }
  return pages.join('\n\n');
}

async function readDocxText(file) {
  await loadScriptOnce(IMPORT_LIBS.docx);
  const result = await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return result.value || '';
}

// ── Progress / preview window (reuses the import modal) ──
let importTicker = null;
let importPreviewData = null;
let importRunId = 0; // bumped when the window is closed, so a late result is ignored

function showImportWindow(title, bodyHTML, note = '') {
  document.getElementById('importPickTitle').innerHTML = title;
  document.getElementById('importPickNote').textContent = note;
  const list = document.getElementById('importPickList');
  list.innerHTML = bodyHTML;
  // Progress, errors and the preview aren't a scrolling list.
  list.classList.add('is-preview');
  document.getElementById('importAllBtn').hidden = true;
  document.getElementById('importPickModal').style.display = 'flex';
}

function showImportProgress(fileName, step) {
  const started = Date.now();
  clearInterval(importTicker);
  const paint = (text) => {
    const secs = Math.floor((Date.now() - started) / 1000);
    showImportWindow(
      '<i class="fas fa-file-import"></i> Importing your resume',
      `<div class="ai-loading"><i class="fas fa-spinner fa-spin"></i><span>${escapeHTML(text)}</span><span class="ai-elapsed">${secs}s</span></div>`,
      fileName
    );
  };
  let current = step;
  paint(current);
  importTicker = setInterval(() => paint(current), 1000);
  return (next) => { current = next; paint(current); };
}

function stopImportProgress() {
  clearInterval(importTicker);
  importTicker = null;
}

function showImportError(message, tip = '') {
  stopImportProgress();
  showImportWindow(
    '<i class="fas fa-file-circle-exclamation"></i> Could not import this file',
    `<div class="tone-error">⚠️ ${escapeHTML(message)}${tip ? `<br><small>${escapeHTML(tip)}</small>` : ''}</div>`
  );
}

// ── Main entry: called by the Import button for every file ──
async function importResumeFile(file) {
  const kind = fileKind(file);

  if (kind === 'json') {
    const text = await file.text();
    let obj;
    try { obj = JSON.parse(text); } catch (e) { showToast('❌ This file is not valid JSON', 'error'); return; }
    if (typeof handleImportedJSON === 'function') handleImportedJSON(obj);
    else if (obj && typeof obj.personal === 'object') { restoreFromData(obj); showToast('✅ Resume imported', 'success'); }
    return;
  }
  if (kind === 'doc') {
    return showImportError('Old Word files (.doc) can\'t be read.', 'In Word, choose File → Save As → Word Document (.docx), or save it as PDF, then import that.');
  }
  if (kind === 'other') {
    return showImportError('This type of file can\'t be imported.', 'Choose a PDF, a Word file (.docx), or a JSON file from Export.');
  }
  if (file.size > IMPORT_MAX_BYTES) {
    return showImportError('This file is larger than 10 MB.', 'Save your resume again without large pictures, then try again.');
  }

  if (!(typeof canUseSiteAI === 'function' && canUseSiteAI())) {
    return showImportError('Reading a PDF or Word resume uses AI, so you need to sign in first.', 'You can still import a JSON backup without signing in.');
  }

  const runId = ++importRunId;
  const cancelled = () => runId !== importRunId;
  const setStep = showImportProgress(file.name, kind === 'pdf' ? 'Reading the PDF...' : 'Reading the Word file...');
  let text;
  try {
    text = kind === 'pdf' ? await readPdfText(file) : await readDocxText(file);
    if (cancelled()) return;
  } catch (err) {
    if (cancelled()) return;
    const msg = /password/i.test(err?.message || '') ? 'This PDF is password-protected.' : (err?.message || 'The file could not be read.');
    return showImportError(msg, 'Make sure the file opens normally on your computer, then try again.');
  }
  text = text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (text.length < 80) {
    return showImportError(
      'No text could be found in this file.',
      kind === 'pdf' ? 'It is probably a scanned image. Import the original Word file instead, or type your details in.' : 'The document looks empty.'
    );
  }

  setStep('AI is sorting your resume into sections...');
  let data;
  try {
    data = await extractResumeWithAI(text.slice(0, IMPORT_MAX_TEXT), setStep);
    if (cancelled()) return;
  } catch (err) {
    if (cancelled()) return;
    const hint = typeof geminiErrorHint === 'function' ? geminiErrorHint(err.status, err) : '';
    return showImportError(err.message || 'The AI could not read this resume.', hint);
  }
  stopImportProgress();
  showImportPreview(data, file.name, text.length > IMPORT_MAX_TEXT);
}

function extractionPrompt(text) {
  return `You convert a resume's plain text into structured data for a resume builder.

Rules:
- Use ONLY information that appears in the text. Never invent or guess employers, dates, numbers, skills or contact details. Leave a field as "" (or [] for lists) when the text doesn't say.
- Keep the original wording of descriptions. Put each bullet point on its own line, starting with "• ".
- Dates: "YYYY-MM". If only a year is given, use "YYYY-01". If a job is ongoing ("Present", "Current", "Now"), set "current": true and "endDate": "".
- skills: one entry per skill, short names only (e.g. "React", "Project management"). "level" is 50 (basic), 75 (good) or 100 (expert) only when the text states a level, otherwise 75.
- languages: CEFR levels (A1–C2) only when the text gives them or a clear equivalent (Native → "mother": true; Fluent → C1; Intermediate → B1; Basic → A2). Otherwise leave the levels "".
- Anything that fits none of the sections (certifications, volunteering, publications, awards, interests, references...) goes in customSections, grouped under its heading.
- The person's own name goes in personal, split into first/middle/last.

Resume text:
"""
${text}
"""

Respond only with JSON in exactly this shape:
{
  "personal": {"firstname": "", "middlename": "", "lastname": "", "designation": "job title", "address": "city, country", "email": "", "phoneno": "", "website": "", "summary": ""},
  "experiences": [{"title": "", "organization": "", "location": "", "startDate": "", "endDate": "", "current": false, "description": ""}],
  "educations": [{"degree": "", "school": "", "city": "", "startDate": "", "endDate": "", "description": ""}],
  "skills": [{"skill": "", "level": "75"}],
  "projects": [{"title": "", "link": "", "description": ""}],
  "achievements": [{"title": "", "description": ""}],
  "languages": [{"language": "", "mother": false, "listening": "", "reading": "", "speaking": "", "writing": ""}],
  "customSections": [{"name": "", "items": [{"title": "", "description": ""}]}]
}`;
}

async function extractResumeWithAI(text, onStatus) {
  const result = await callGeminiWithRetry({
    contents: [{ parts: [{ text: extractionPrompt(text) }] }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 8192, responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: 'low' } }
  }, onStatus);
  return normalizeImportedResume(parseGeminiJSON(result));
}

// Keeps only known fields with sensible values, whatever the AI returned.
function normalizeImportedResume(raw) {
  const str = (v, max = 2000) => (typeof v === 'string' ? v : (v == null ? '' : String(v))).trim().slice(0, max);
  const month = (v) => {
    const s = str(v, 20);
    if (/^\d{4}-(0[1-9]|1[0-2])$/.test(s)) return s;
    if (/^\d{4}$/.test(s)) return s + '-01';
    return '';
  };
  const arr = (v, max) => (Array.isArray(v) ? v.filter(x => x && typeof x === 'object').slice(0, max) : []);
  const cefr = (v) => (/^[ABC][12]$/.test(str(v, 2).toUpperCase()) ? str(v, 2).toUpperCase() : '');
  const level = (v) => { const n = parseInt(v, 10); return ['25', '50', '75', '100'].includes(String(n)) ? String(n) : '75'; };
  const p = raw?.personal || {};

  return {
    personal: {
      firstname: str(p.firstname, 60), middlename: str(p.middlename, 60), lastname: str(p.lastname, 60),
      designation: str(p.designation, 120), address: str(p.address, 160), email: str(p.email, 120),
      phoneno: str(p.phoneno, 40), website: str(p.website, 200), summary: str(p.summary, 1500), image: ''
    },
    experiences: arr(raw?.experiences, 20).map(x => {
      const current = x.current === true;
      return { title: str(x.title, 120), organization: str(x.organization, 120), location: str(x.location, 120),
        startDate: month(x.startDate), endDate: current ? '' : month(x.endDate), current, description: str(x.description) };
    }).filter(x => x.title || x.organization),
    educations: arr(raw?.educations, 15).map(x => ({ degree: str(x.degree, 160), school: str(x.school, 160), city: str(x.city, 120),
      startDate: month(x.startDate), endDate: month(x.endDate), description: str(x.description) })).filter(x => x.degree || x.school),
    skills: arr(raw?.skills, 40).map(x => ({ skill: str(x.skill, 60), level: level(x.level) })).filter(x => x.skill),
    projects: arr(raw?.projects, 15).map(x => ({ title: str(x.title, 120), link: str(x.link, 300), description: str(x.description) })).filter(x => x.title),
    achievements: arr(raw?.achievements, 15).map(x => ({ title: str(x.title, 160), description: str(x.description) })).filter(x => x.title),
    languages: arr(raw?.languages, 10).map(x => ({ language: str(x.language, 40), mother: x.mother === true,
      listening: cefr(x.listening), reading: cefr(x.reading), speaking: cefr(x.speaking), writing: cefr(x.writing) })).filter(x => x.language),
    customSections: arr(raw?.customSections, 8).map(s => ({
      name: str(s.name, 60) || 'Other',
      items: arr(s.items, 20).map(i => ({ title: str(i.title, 160), description: str(i.description) })).filter(i => i.title || i.description)
    })).filter(s => s.items.length)
  };
}

function showImportPreview(data, fileName, truncated) {
  importPreviewData = data;
  const p = data.personal;
  const name = [p.firstname, p.middlename, p.lastname].filter(Boolean).join(' ');
  const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const rows = [
    ['fa-user', 'Name', name || '—'],
    ['fa-briefcase', 'Job title', p.designation || '—'],
    ['fa-address-card', 'Contact', [p.email, p.phoneno, p.address].filter(Boolean).join(' · ') || '—'],
    ['fa-align-left', 'Summary', p.summary ? 'Yes' : '—'],
    ['fa-building', 'Experience', count(data.experiences.length, 'job', 'jobs')],
    ['fa-graduation-cap', 'Education', count(data.educations.length, 'entry', 'entries')],
    ['fa-screwdriver-wrench', 'Skills', data.skills.length ? data.skills.slice(0, 8).map(s => s.skill).join(', ') + (data.skills.length > 8 ? ` +${data.skills.length - 8} more` : '') : '—'],
    ['fa-diagram-project', 'Projects', count(data.projects.length, 'project', 'projects')],
    ['fa-language', 'Languages', data.languages.map(l => l.language).join(', ') || '—'],
    ['fa-layer-group', 'Other sections', data.customSections.map(s => s.name).join(', ') || '—']
  ];
  const signedIn = typeof canUseSiteAI === 'function' && canUseSiteAI();
  showImportWindow(
    '<i class="fas fa-circle-check"></i> Here\'s what we found',
    `<dl class="account-facts import-preview">${rows.map(([icon, label, value]) =>
      `<div><dt><i class="fas ${icon}"></i> ${label}</dt><dd>${escapeHTML(value)}</dd></div>`).join('')}</dl>
     <p class="hint-text">${truncated ? 'The file was very long, so only the first part was read. ' : ''}AI can make mistakes: check each section after opening.</p>
     <div class="signout-actions">
       <button type="button" class="btn-icon" onclick="closeImportPicker()">Cancel</button>
       <button type="button" class="btn-primary" onclick="confirmImportPreview()"><i class="fas fa-folder-open"></i> ${signedIn ? 'Open as a new resume' : 'Open in the builder'}</button>
     </div>`,
    fileName
  );
}

function confirmImportPreview() {
  const data = importPreviewData;
  if (!data) return;
  importPreviewData = null;
  closeImportPicker();
  const p = data.personal;
  const name = [p.firstname, p.lastname].filter(Boolean).join(' ');
  if (typeof openImportedResume === 'function') openImportedResume(data, name ? `${name} (imported)` : 'Imported Resume');
  else { restoreFromData(data); showToast('✅ Resume imported', 'success'); }
}

// Closing the window mid-import (× or a click outside) cancels it.
document.addEventListener('click', (e) => {
  if (!importTicker) return;
  if (e.target.closest?.('#importPickModal .btn-close') || e.target.id === 'importPickModal') {
    importRunId++;
    stopImportProgress();
  }
});
