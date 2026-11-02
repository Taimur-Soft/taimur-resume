// ======================================================
// Export menu: Word (.docx), plain text, Europass XML, HTML page, JSON.
// PDF has its own "Download PDF" button (pdf-export.js).
// Everything is built in the browser from collectFormData().
// ======================================================

const JSZIP_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';

// ── Small helpers ──────────────────────────────────────
const xmlEsc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  // Characters XML 1.0 doesn't allow (control chars from pasted text).
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

function exportMonth(v) {
  if (!/^\d{4}-\d{2}$/.test(v || '')) return '';
  const [y, m] = v.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}
function exportRange(start, end, current) {
  return [exportMonth(start), current ? 'Present' : exportMonth(end)].filter(Boolean).join(' – ');
}
// "• one\n- two" → ["one", "two"]
function descLines(text) {
  return String(text || '').split('\n').map(l => l.replace(/^[\s•\-*–]+/, '').trim()).filter(Boolean);
}
function fullNameOf(p) {
  return [p.firstname, p.middlename, p.lastname].filter(Boolean).join(' ');
}
function languageLine(l) {
  if (l.mother) return 'Mother tongue';
  return CEFR_SKILLS.map(s => (l[s.key] ? `${s.label} ${l[s.key]}` : '')).filter(Boolean).join(' · ');
}
function exportFileBase(p) {
  const name = fullNameOf(p).replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
  return (name || 'My') + '-Resume';
}
function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}
function loadJSZip() {
  if (window.JSZip) return Promise.resolve(window.JSZip);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = JSZIP_URL;
    s.onload = () => resolve(window.JSZip);
    s.onerror = () => reject(new Error('Could not load the Word file builder. Check your internet connection.'));
    document.head.appendChild(s);
  });
}

// The resume's sections in reading order, as plain data every format uses.
function exportSections(d) {
  const out = [];
  if (d.personal.summary) out.push({ title: 'Summary', paragraphs: [d.personal.summary] });
  const exp = d.experiences.filter(x => x.title || x.organization);
  if (exp.length) out.push({ title: 'Work Experience', items: exp.map(x => ({
    heading: [x.title, x.organization].filter(Boolean).join(' — '),
    meta: [exportRange(x.startDate, x.endDate, x.current), x.location].filter(Boolean).join(' · '),
    bullets: descLines(x.description)
  })) });
  const edu = d.educations.filter(x => x.degree || x.school);
  if (edu.length) out.push({ title: 'Education', items: edu.map(x => ({
    heading: [x.degree, x.school].filter(Boolean).join(' — '),
    meta: [exportRange(x.startDate, x.endDate), x.city].filter(Boolean).join(' · '),
    bullets: descLines(x.description)
  })) });
  if (d.skills.length) out.push({ title: 'Skills', paragraphs: [d.skills.map(s => s.skill).join(', ')] });
  const proj = d.projects.filter(x => x.title);
  if (proj.length) out.push({ title: 'Projects', items: proj.map(x => ({ heading: x.title, meta: x.link || '', bullets: descLines(x.description) })) });
  const ach = d.achievements.filter(x => x.title);
  if (ach.length) out.push({ title: 'Achievements', items: ach.map(x => ({ heading: x.title, meta: '', bullets: descLines(x.description) })) });
  const langs = (d.languages || []).filter(l => l.language);
  if (langs.length) out.push({ title: 'Languages', items: langs.map(l => ({ heading: l.language, meta: languageLine(l), bullets: [] })) });
  (d.customSections || []).forEach(s => {
    const items = (s.items || []).filter(i => i.title || i.description);
    if (items.length) out.push({ title: s.name || 'Other', items: items.map(i => ({ heading: i.title, meta: '', bullets: descLines(i.description) })) });
  });
  return out;
}

// ── Plain text ─────────────────────────────────────────
function buildResumeText(d) {
  const p = d.personal;
  const lines = [];
  const name = fullNameOf(p);
  if (name) lines.push(name.toUpperCase());
  if (p.designation) lines.push(p.designation);
  const contact = [p.email, p.phoneno, p.address, p.website].filter(Boolean).join(' | ');
  if (contact) lines.push(contact);
  exportSections(d).forEach(sec => {
    lines.push('', sec.title.toUpperCase(), '-'.repeat(sec.title.length));
    (sec.paragraphs || []).forEach(t => lines.push(t));
    (sec.items || []).forEach((it, i) => {
      if (i > 0 && (sec.items[i - 1].bullets.length || it.bullets.length)) lines.push('');
      lines.push(it.heading + (it.meta && !it.bullets.length && sec.title === 'Languages' ? `: ${it.meta}` : ''));
      if (it.meta && sec.title !== 'Languages') lines.push(it.meta);
      it.bullets.forEach(b => lines.push(`- ${b}`));
    });
  });
  return lines.join('\r\n') + '\r\n';
}

// ── Word (.docx) ───────────────────────────────────────
// A clean single-column layout with real Word headings, which ATS systems
// read well. Built as plain WordprocessingML and zipped with JSZip.
function docxRun(text, o = {}) {
  const props = [
    o.bold ? '<w:b/>' : '', o.italic ? '<w:i/>' : '',
    o.color ? `<w:color w:val="${o.color}"/>` : '', o.size ? `<w:sz w:val="${o.size}"/>` : ''
  ].join('');
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${xmlEsc(text)}</w:t></w:r>`;
}
function docxPara(runs, o = {}) {
  const props = [
    o.style ? `<w:pStyle w:val="${o.style}"/>` : '',
    o.keepNext ? '<w:keepNext/>' : '',
    o.after != null || o.before != null ? `<w:spacing w:before="${o.before || 0}" w:after="${o.after ?? 120}"/>` : '',
    o.indent ? '<w:ind w:left="360" w:hanging="220"/>' : ''
  ].join('');
  return `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ''}${Array.isArray(runs) ? runs.join('') : runs}</w:p>`;
}

function buildDocxDocument(d) {
  const p = d.personal;
  const body = [];
  const name = fullNameOf(p);
  if (name) body.push(docxPara(docxRun(name), { style: 'Title' }));
  if (p.designation) body.push(docxPara(docxRun(p.designation, { color: '003399', size: 26 }), { after: 60 }));
  const contact = [p.email, p.phoneno, p.address, p.website].filter(Boolean).join('  |  ');
  if (contact) body.push(docxPara(docxRun(contact, { color: '5B6477', size: 19 }), { after: 120 }));

  exportSections(d).forEach(sec => {
    body.push(docxPara(docxRun(sec.title), { style: 'Heading1' }));
    (sec.paragraphs || []).forEach(t => descLines(t).length > 1
      ? descLines(t).forEach(l => body.push(docxPara(docxRun(l), { after: 40 })))
      : body.push(docxPara(docxRun(t), { after: 120 })));
    (sec.items || []).forEach(it => {
      const inline = sec.title === 'Languages';
      body.push(docxPara([
        docxRun(it.heading, { bold: true }),
        inline && it.meta ? docxRun(`  —  ${it.meta}`, { color: '5B6477' }) : ''
      ], { keepNext: !inline, after: inline ? 60 : 20, before: inline ? 0 : 80 }));
      if (!inline && it.meta) body.push(docxPara(docxRun(it.meta, { italic: true, color: '5B6477', size: 19 }), { keepNext: it.bullets.length > 0, after: 40 }));
      it.bullets.forEach(b => body.push(docxPara([docxRun('•\t'), docxRun(b)], { indent: true, after: 30 })));
    });
  });

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1000" w:right="1000" w:bottom="1000" w:left="1000" w:header="600" w:footer="600" w:gutter="0"/></w:sectPr></w:body></w:document>`;
}

const DOCX_STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="21"/><w:color w:val="1E293B"/><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/><w:tabs><w:tab w:val="left" w:pos="360"/></w:tabs></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="40"/></w:pPr><w:rPr><w:b/><w:color w:val="0B1F4D"/><w:sz w:val="44"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="280" w:after="100"/><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="2" w:color="C3D0EE"/></w:pBdr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:caps/><w:color w:val="003399"/><w:spacing w:val="10"/><w:sz w:val="23"/></w:rPr></w:style>
</w:styles>`;

async function buildDocxBlob(d) {
  const JSZip = await loadJSZip();
  const zip = new JSZip();
  const name = fullNameOf(d.personal) || 'Resume';
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`);
  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  zip.file('word/styles.xml', DOCX_STYLES);
  zip.file('word/document.xml', buildDocxDocument(d));
  zip.file('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEsc(name)} — Resume</dc:title><dc:creator>${xmlEsc(name)}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created></cp:coreProperties>`);
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

// ── Europass XML (SkillsPassport, schema V3.3) ─────────
// The format the Europass CV editor exports and can import again.
function europassPeriod(start, end, current) {
  const date = (tag, v) => {
    if (!/^\d{4}-\d{2}$/.test(v || '')) return '';
    const [y, m] = v.split('-');
    return `<${tag} year="${y}" month="--${m}"/>`;
  };
  const from = date('From', start);
  const to = current ? '<Current>true</Current>' : date('To', end);
  return from || to ? `<Period>${from}${to}</Period>` : '';
}
function europassText(text) {
  // Europass descriptions are rich text (escaped HTML): keep bullets as a list.
  const lines = descLines(text);
  if (!lines.length) return '';
  const html = lines.length > 1 ? `<ul>${lines.map(l => `<li>${xmlEsc(l)}</li>`).join('')}</ul>` : `<p>${xmlEsc(lines[0])}</p>`;
  return xmlEsc(html);
}
function europassPlace(city) {
  return city ? `<ContactInfo><Address><Contact><Municipality>${xmlEsc(city)}</Municipality></Contact></Address></ContactInfo>` : '';
}

function buildEuropassXML(d) {
  const p = d.personal;
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const firstNames = [p.firstname, p.middlename].filter(Boolean).join(' ');
  const contact = [
    p.address ? `<Address><Contact><AddressLine>${xmlEsc(p.address)}</AddressLine></Contact></Address>` : '',
    p.email ? `<Email><Contact>${xmlEsc(p.email)}</Contact></Email>` : '',
    p.phoneno ? `<TelephoneList><Telephone><Contact>${xmlEsc(p.phoneno)}</Contact><Use><Code>mobile</Code></Use></Telephone></TelephoneList>` : '',
    p.website ? `<WebsiteList><Website><Contact>${xmlEsc(p.website)}</Contact><Use><Code>personal</Code></Use></Website></WebsiteList>` : ''
  ].join('');

  const work = d.experiences.filter(x => x.title || x.organization).map(x => `<WorkExperience>${europassPeriod(x.startDate, x.endDate, x.current)}<Position><Label>${xmlEsc(x.title)}</Label></Position>${x.description ? `<Activities>${europassText(x.description)}</Activities>` : ''}<Employer><Name>${xmlEsc(x.organization)}</Name>${europassPlace(x.location)}</Employer></WorkExperience>`).join('');
  const edu = d.educations.filter(x => x.degree || x.school).map(x => `<Education>${europassPeriod(x.startDate, x.endDate)}<Title>${xmlEsc(x.degree)}</Title>${x.description ? `<Activities>${europassText(x.description)}</Activities>` : ''}<Organisation><Name>${xmlEsc(x.school)}</Name>${europassPlace(x.city)}</Organisation></Education>`).join('');

  const langs = (d.languages || []).filter(l => l.language);
  const mother = langs.filter(l => l.mother).map(l => `<MotherTongue><Description><Label>${xmlEsc(l.language)}</Label></Description></MotherTongue>`).join('');
  const level = (v) => (/^[ABC][12]$/.test(v || '') ? v : '');
  const foreign = langs.filter(l => !l.mother).map(l => {
    const lv = { Listening: level(l.listening), Reading: level(l.reading), SpokenInteraction: level(l.speaking), SpokenProduction: level(l.speaking), Writing: level(l.writing) };
    const levels = Object.entries(lv).filter(([, v]) => v).map(([k, v]) => `<${k}>${v}</${k}>`).join('');
    return `<ForeignLanguage><Description><Label>${xmlEsc(l.language)}</Label></Description>${levels ? `<ProficiencyLevel>${levels}</ProficiencyLevel>` : ''}</ForeignLanguage>`;
  }).join('');
  const linguistic = mother || foreign
    ? `<Linguistic>${mother ? `<MotherTongueList>${mother}</MotherTongueList>` : ''}${foreign ? `<ForeignLanguageList>${foreign}</ForeignLanguageList>` : ''}</Linguistic>` : '';
  const skillsText = d.skills.map(s => s.skill).filter(Boolean);
  const other = skillsText.length ? `<Other><Description>${xmlEsc(`<p>${xmlEsc(skillsText.join(', '))}</p>`)}</Description></Other>` : '';

  // Projects, achievements and custom sections → "Additional information".
  const extras = [];
  const addExtra = (code, label, items) => {
    const body = items.map(i => `<p><strong>${xmlEsc(i.title)}</strong>${i.link ? ` (${xmlEsc(i.link)})` : ''}</p>${descLines(i.description).length ? `<ul>${descLines(i.description).map(l => `<li>${xmlEsc(l)}</li>`).join('')}</ul>` : ''}`).join('');
    if (body) extras.push(`<Achievement><Title>${code ? `<Code>${code}</Code>` : ''}<Label>${xmlEsc(label)}</Label></Title><Description>${xmlEsc(body)}</Description></Achievement>`);
  };
  // Europass allows one headline; when the job title takes it, the summary
  // goes first under additional information instead.
  if (p.designation && p.summary) {
    extras.push(`<Achievement><Title><Label>Personal statement</Label></Title><Description>${europassText(p.summary)}</Description></Achievement>`);
  }
  addExtra('projects', 'Projects', d.projects.filter(x => x.title));
  addExtra('honors_awards', 'Achievements', d.achievements.filter(x => x.title));
  (d.customSections || []).forEach(s => addExtra('', s.name || 'Other', (s.items || []).filter(i => i.title || i.description)));

  return `<?xml version="1.0" encoding="UTF-8"?>
<SkillsPassport xmlns="http://europass.cedefop.europa.eu/Europass" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" locale="en">
  <DocumentInfo>
    <DocumentType>ECV</DocumentType>
    <CreationDate>${now}</CreationDate>
    <LastUpdateDate>${now}</LastUpdateDate>
    <XSDVersion>V3.3</XSDVersion>
    <Generator>Taimur Resume</Generator>
    <EuropassLogo>true</EuropassLogo>
  </DocumentInfo>
  <LearnerInfo>
    <Identification>
      <PersonName><FirstName>${xmlEsc(firstNames)}</FirstName><Surname>${xmlEsc(p.lastname)}</Surname></PersonName>
      ${contact ? `<ContactInfo>${contact}</ContactInfo>` : ''}
    </Identification>
    ${p.designation
      ? `<Headline><Type><Code>position</Code><Label>Position</Label></Type><Description><Label>${xmlEsc(p.designation)}</Label></Description></Headline>`
      : (p.summary ? `<Headline><Type><Code>personal_statement</Code><Label>Personal statement</Label></Type><Description><Label>${xmlEsc(p.summary)}</Label></Description></Headline>` : '')}
    ${work ? `<WorkExperienceList>${work}</WorkExperienceList>` : ''}
    ${edu ? `<EducationList>${edu}</EducationList>` : ''}
    ${linguistic || other ? `<Skills>${linguistic}${other}</Skills>` : ''}
    ${extras.length ? `<AchievementList>${extras.join('')}</AchievementList>` : ''}
  </LearnerInfo>
</SkillsPassport>
`;
}

// ── HTML page (same design as the preview) ─────────────
async function buildResumeHTMLPage(d) {
  const css = await Promise.all(['assets/css/theme.css', 'assets/css/main.css'].map(u =>
    fetch(u).then(r => (r.ok ? r.text() : '')).catch(() => '')));
  const name = fullNameOf(d.personal) || 'Resume';
  const tpl = /^[a-z]+$/.test(d.template || '') ? d.template : 'aurora';
  return `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHTML(name)} — Resume</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Playfair+Display:wght@400;600;700&family=Poppins:wght@400;500;600;700;800&family=Space+Grotesk:wght@400;500;600;700&family=Lora:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
<style>
${css.join('\n')}
html, body { height: auto !important; overflow: auto !important; }
body { background: #e9edf5; margin: 0; padding: 32px 16px; display: block; }
.resume-preview { margin: 0 auto; box-shadow: 0 10px 40px rgba(11, 31, 77, .15); }
.export-footer { text-align: center; font: 12px Inter, sans-serif; color: #64748b; margin-top: 18px; }
@media print { body { background: #fff; padding: 0; } .resume-preview { box-shadow: none; } .export-footer { display: none; } }
</style>
</head>
<body>
<div class="resume-preview template-${tpl}">${buildResumeHTML(d)}</div>
<p class="export-footer">Made with Taimur Resume</p>
</body>
</html>
`;
}

// ── Menu actions ───────────────────────────────────────
async function exportResumeAs(format) {
  closeExportMenu();
  if (format === 'json') return exportJSON(); // a full backup, kept as typed
  // Sensitive details (e.g. religion) never go into a CV file (app.js).
  const d = stripSensitiveItems(collectFormData());
  const p = d.personal;
  if (!p.firstname && !p.lastname && !p.designation) {
    showToast('Fill in at least your name first', 'error');
    return;
  }
  const base = exportFileBase(p);
  try {
    if (format === 'docx') {
      showToast('Preparing your Word file...', 'info');
      downloadBlob(await buildDocxBlob(d), `${base}.docx`);
      showToast('✅ Word file downloaded', 'success');
    } else if (format === 'txt') {
      downloadBlob(new Blob(['﻿' + buildResumeText(d)], { type: 'text/plain;charset=utf-8' }), `${base}.txt`);
      showToast('✅ Text file downloaded', 'success');
    } else if (format === 'europass') {
      downloadBlob(new Blob([buildEuropassXML(d)], { type: 'application/xml' }), `${base}-Europass.xml`);
      showToast('✅ Europass XML downloaded. Import it at europass.europa.eu', 'success');
    } else if (format === 'html') {
      downloadBlob(new Blob([await buildResumeHTMLPage(d)], { type: 'text/html;charset=utf-8' }), `${base}.html`);
      showToast('✅ Web page downloaded', 'success');
    }
  } catch (err) {
    showToast('❌ Could not export: ' + (err.message || err), 'error');
  }
}

function toggleExportMenu() {
  const panel = document.getElementById('exportMenuPanel');
  if (panel.hidden) openExportMenu(); else closeExportMenu();
}
function openExportMenu() {
  if (typeof closeAccountMenu === 'function') closeAccountMenu();
  const panel = document.getElementById('exportMenuPanel');
  panel.hidden = false;
  document.getElementById('exportMenuBtn').setAttribute('aria-expanded', 'true');
  panel.querySelector('[role="menuitem"]')?.focus();
}
function closeExportMenu() {
  const panel = document.getElementById('exportMenuPanel');
  if (!panel || panel.hidden) return;
  panel.hidden = true;
  document.getElementById('exportMenuBtn')?.setAttribute('aria-expanded', 'false');
}
document.addEventListener('click', (e) => {
  if (!e.target.closest?.('#exportMenu')) closeExportMenu();
});
document.addEventListener('keydown', (e) => {
  const panel = document.getElementById('exportMenuPanel');
  if (!panel || panel.hidden) return;
  if (e.key === 'Escape') { closeExportMenu(); document.getElementById('exportMenuBtn')?.focus(); return; }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const items = [...panel.querySelectorAll('[role="menuitem"]')];
    const i = items.indexOf(document.activeElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
  }
});
