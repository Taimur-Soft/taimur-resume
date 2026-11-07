// ======================================================
// PDF Export Module
//
// 1. Vector PDF (preferred): the server (api/pdf.js) prints the resume in
//    headless Chrome from print.html, the way professional resume sites do:
//    real text and shapes, sharp at any zoom, a small file, and text that
//    ATS systems read directly. Same layout choice as below (pdfChooseLayout).
// 2. In-browser PDF (fallback, e.g. offline or local development):
//    renders the resume (html2canvas) into a paginated A4 PDF (jsPDF).
//
// Typesetting:
// - The on-screen preview is 420 px wide, which put text at about 15 pt on
//   A4. For the PDF the page is laid out 600–690 px wide instead; the
//   templates size text in px, so text keeps its size while the page gets
//   wider and lands at a normal 10–11 pt, like a professionally set CV.
// - Columns are paginated separately (like a layout program does): in a
//   two-column template each column flows onto the next page on its own,
//   so neither column has to cut an entry because of the other.
// - Breaks never cut a line, never separate a section title from its first
//   entry, keep every entry (a job, a degree...) whole, and keep short
//   sections (languages, skills, certifications) together.
// - Fit to pages (Europass advice: 1 page, 2 at most for long careers):
//   the most comfortable layout that reaches the fewest pages is used.
//   Layouts get more compact by trimming white space first, and text never
//   goes below 9 pt for descriptions (10 pt for the summary).
// - Pages that continue get top/bottom margins; backgrounds and sidebars
//   run to the bottom edge of every page; page numbers on multi-page CVs.
// Quality: ~250 DPI, lossless PNG, plus an invisible text layer so ATS
// systems (and copy/paste) can read the words.
// Falls back to the browser's print-to-PDF if the libraries fail to load.
// ======================================================

// Layouts tried, most comfortable first. w = CSS px across the A4 width
// (595 pt), so text in px gets smaller as w grows: at 660 the 10 px
// descriptions are 9 pt, the smallest size readability guidance accepts
// for body text, so w never goes past that. tight = white-space level
// (.pdf-tight-1 / -2 in main.css), which never changes the text size.
const PDF_LAYOUTS = [
  { w: 600, tight: 0 },
  { w: 630, tight: 0 },
  { w: 630, tight: 1 },
  { w: 660, tight: 1 },
  { w: 660, tight: 2 },
  { w: 660, tight: 3 }
];
const PDF_TARGET_PX = 2100;                   // ≈ 250 DPI across A4
const PDF_CONT_TOP = 30;                      // top margin (px) on pages after the first
const PDF_BOTTOM = 30;                        // bottom margin (px) on pages that continue
const PDF_MAX_CANVAS_PIXELS = 16e6;           // phones (iOS) refuse bigger canvases

const PDF_LINES = 'p, li, h1, h2, h3, h4, h5, h6, tr, img, span, a, strong, small';
const PDF_ITEMS = '.eu-item, .eu-skill, .eu-lang-table, .eu-lang-mother, .eu-skill-tags, .eu-contact-item, .eu-about-text, [class*="item"], table';

const pdfPageH = (w) => Math.round(w * 297 / 210);

// Gives a copy of the resume its PDF size, outside any page layout.
function pdfStyleResume(el, w, tight = 0) {
  el.classList.remove('pdf-tight-1', 'pdf-tight-2', 'pdf-tight-3');
  if (tight) el.classList.add('pdf-tight-' + tight);
  if (tight === 3) el.classList.add('pdf-tight-2'); // level 3 builds on level 2
  Object.assign(el.style, {
    width: w + 'px', maxWidth: w + 'px', minWidth: w + 'px',
    minHeight: pdfPageH(w) + 'px', height: 'auto', flex: 'none',
    fontSize: '11px', boxShadow: 'none', borderRadius: '0', margin: '0'
  });
}

// Two-column templates: share the sections out between the columns again at
// the PDF's width (app.js), so neither column ends up empty on a page while
// the other runs on.
function pdfBalance(el) {
  if (typeof balanceResumeColumns === 'function') balanceResumeColumns(el);
}

// Layout facts, in CSS px from the top of the resume:
// { totalH, headerH, columns: [{ x0, x1, top, contentH, lines, items }] }
// headerH is a full-width band that only appears on page 1 (the banner).
function pdfMeasure(el, w) {
  const pageH = pdfPageH(w);
  const er = el.getBoundingClientRect();
  const grid = el.querySelector('.rv-eu-sidebar') || el.querySelector('.eu-body');
  const colEls = grid && grid.children.length > 1 ? [...grid.children] : [el];
  const headerH = colEls[0] === el ? 0 : colEls[0].getBoundingClientRect().top - er.top;

  const columns = colEls.map(col => {
    const cr = col.getBoundingClientRect();
    const rel = (r) => [r.top - cr.top, r.bottom - cr.top];
    const boxes = (sel, max) => [...col.querySelectorAll(sel)]
      .map(n => n.getBoundingClientRect())
      .filter(r => r.height > 0 && r.height < max)
      .map(rel);
    const lines = boxes(PDF_LINES, pageH * 0.5);
    const items = boxes(PDF_ITEMS, pageH * 0.6);
    col.querySelectorAll('.eu-section').forEach(sec => {
      const sr = sec.getBoundingClientRect();
      // Short sections stay in one piece.
      if (sr.height < pageH * 0.35) items.push(rel(sr));
      // A title always comes with its first entry.
      const h = sec.querySelector(':scope > h3, :scope > h2');
      if (h) {
        const hr = h.getBoundingClientRect();
        const nr = h.nextElementSibling?.getBoundingClientRect();
        items.push([hr.top - cr.top, (nr && nr.height < pageH * 0.5 ? nr.bottom : hr.bottom + 60) - cr.top]);
      }
    });
    // Where the column's own content ends (it may be stretched taller).
    const padB = parseFloat(getComputedStyle(col).paddingBottom) || 0;
    const lastBottom = Math.max(0, ...[...col.children].map(c => c.getBoundingClientRect().bottom - cr.top));
    const contentH = col === el ? cr.height : Math.min(cr.height, lastBottom + padB);
    return { x0: cr.left - er.left, x1: cr.right - er.left, top: cr.top - er.top, contentH, lines, items };
  });
  return { totalH: er.height, headerH, columns };
}

// Every line of text with its exact box (CSS px from the resume's top
// left), so the PDF can put real, selectable text right over the picture
// of it. Words that sit on the same line in the same text node are joined.
function pdfCollectText(el) {
  const doc = el.ownerDocument;
  const win = doc.defaultView;
  const er = el.getBoundingClientRect();
  const range = doc.createRange();
  const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const out = [];
  let node;
  while ((node = walker.nextNode())) {
    const text = node.nodeValue;
    if (!text || !text.trim() || !node.parentElement) continue;
    const fs = parseFloat(win.getComputedStyle(node.parentElement).fontSize) || 11;
    const re = /\S+/g;
    let m;
    let line = null;
    while ((m = re.exec(text))) {
      range.setStart(node, m.index);
      range.setEnd(node, m.index + m[0].length);
      const r = [...range.getClientRects()].find(b => b.width > 0 && b.height > 0);
      if (!r) continue;
      const word = { t: m[0], x: r.left - er.left, y: r.top - er.top, w: r.width, h: r.height, fs };
      if (line && Math.abs(line.y - word.y) < 1.5 && word.x >= line.x + line.w - 1) {
        line.t += ' ' + word.t;
        line.w = word.x + word.w - line.x;
        line.h = Math.max(line.h, word.h);
      } else {
        if (line) out.push(line);
        line = word;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

// The built-in PDF font covers Latin-1 only: swap common symbols, drop the
// rest (e.g. Bangla still shows in the picture, it just can't be selected).
function pdfLatin1(s) {
  return s
    .replace(/[–—]/g, '-').replace(/[•·]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/↗/g, '').replace(/[^\x20-\x7E\xA0-\xFF]/g, '').trim();
}

// Measures the resume at width w without drawing anything.
function pdfMeasureLive(preview, w, tight = 0) {
  const host = document.createElement('div');
  host.style.cssText = `position:absolute;left:-30000px;top:0;width:${w}px;visibility:hidden;pointer-events:none`;
  const el = preview.cloneNode(true);
  el.removeAttribute('id');
  pdfStyleResume(el, w, tight);
  host.appendChild(el);
  document.body.appendChild(host);
  try {
    pdfBalance(el);
    return pdfMeasure(el, w);
  } finally { host.remove(); }
}

// Page breaks for every column; the document has as many pages as its
// longest column.
function pdfPlan(m, w) {
  const pageH = pdfPageH(w);
  const cols = m.columns.map(c => ({
    ...c,
    breaks: pdfColumnBreaks(c.contentH, c.lines, c.items,
      pageH - (c.top || m.headerH) - PDF_BOTTOM, pageH - PDF_CONT_TOP - PDF_BOTTOM)
  }));
  return { cols, pages: Math.max(...cols.map(c => c.breaks.length - 1)) };
}

// The most comfortable layout (largest text, most space) that reaches the
// fewest pages any layout can: one page whenever the CV can fit on one.
function pdfChooseLayout(preview) {
  const tried = PDF_LAYOUTS.map(l => ({ ...l, pages: pdfPlan(pdfMeasureLive(preview, l.w, l.tight), l.w).pages }));
  const fewest = Math.min(...tried.map(t => t.pages));
  return tried.find(t => t.pages === fewest);
}

// Years of work experience (overlapping jobs counted once) and number of
// jobs, for the Europass length advice: 1 page, or 2 for a long career.
function pdfExperienceSummary(data) {
  const toMonth = (s) => {
    const m = /^(\d{4})-(\d{2})$/.exec(s || '');
    return m ? (+m[1]) * 12 + (+m[2] - 1) : null;
  };
  const now = new Date();
  const nowM = now.getFullYear() * 12 + now.getMonth();
  const jobs = (data.experiences || []).filter(e => e.title || e.organization);
  const spans = jobs
    .map(e => [toMonth(e.startDate), e.current ? nowM : (toMonth(e.endDate) ?? nowM)])
    .filter(([a, b]) => a !== null && b >= a)
    .sort((x, y) => x[0] - y[0]);
  let months = 0, curA = null, curB = null;
  for (const [a, b] of spans) {
    if (curB === null || a > curB) { if (curB !== null) months += curB - curA; curA = a; curB = b; }
    else curB = Math.max(curB, b);
  }
  if (curB !== null) months += curB - curA;
  return { years: months / 12, jobs: jobs.length };
}

const PDF_SERVER_TIMEOUT_MS = 30000; // a cold start of the server's Chrome takes a few seconds

// Vector PDF from the server. Returns { blob, pages }, or null when it is
// unavailable (offline, local development, an error), so the in-browser PDF
// takes over.
async function pdfFromServer(data) {
  if (!/^https?:$/.test(location.protocol)) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PDF_SERVER_TIMEOUT_MS);
  try {
    const res = await fetch('/api/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data }),
      signal: ctrl.signal
    });
    if (!res.ok || !(res.headers.get('Content-Type') || '').includes('application/pdf')) return null;
    const blob = await res.blob();
    if (blob.size < 1000) return null;
    return { blob, pages: parseInt(res.headers.get('X-Pdf-Pages'), 10) || 1 };
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function pdfSaveBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// Same naming as the Export menu: "First-Last-Resume".
function pdfFileBase(data) {
  return typeof exportFileBase === 'function'
    ? exportFileBase(data.personal || {})
    : ([data.personal?.firstname, data.personal?.lastname].filter(Boolean).join('-') || 'My') + '-Resume';
}

// Europass length advice: 1 page, 2 at most for long careers.
function pdfLengthToast(pages, data) {
  const exp = pdfExperienceSummary(data);
  if (pages === 1) {
    showToast('✅ PDF downloaded (1 page)', 'success');
  } else if (pages === 2 && (exp.years >= 10 || exp.jobs > 1)) {
    showToast('✅ PDF downloaded (2 pages)', 'success');
  } else if (pages === 2) {
    showToast('PDF downloaded on 2 pages. Europass advises 1 page with less than 10 years of experience: shorten a few descriptions to fit.', 'info');
  } else {
    showToast(`PDF downloaded on ${pages} pages. Europass CVs should be 2 pages at most: shorten descriptions or remove older entries.`, 'info');
  }
}

async function exportPDF() {
  const btn = document.getElementById('downloadPdfBtn');
  const preview = document.getElementById('resumePreview');

  if (!preview || !preview.innerHTML.trim() || preview.querySelector('#previewEmpty:not([style*="none"])')?.offsetParent) {
    showToast('Please fill in your resume first', 'error');
    return;
  }

  const originalBtnHTML = btn?.innerHTML;
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating...';
  }
  const restoreBtn = () => {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalBtnHTML;
    }
  };

  // 1. Vector PDF from the server.
  const raw = window.__viewedResumeData || collectFormData();
  const pdfData = stripSensitiveItems({ ...raw, template: raw.template || currentTemplate });
  const vector = await pdfFromServer(pdfData);
  if (vector) {
    pdfSaveBlob(vector.blob, `${pdfFileBase(pdfData)}.pdf`);
    pdfLengthToast(vector.pages, pdfData);
    restoreBtn();
    return;
  }

  // 2. In-browser PDF.
  if (typeof html2canvas === 'undefined' || typeof window.jspdf === 'undefined') {
    restoreBtn();
    showToast('⚠️ PDF library unavailable — using Print instead', 'info');
    printCV();
    return;
  }

  try {
    // Fonts must be ready, or the canvas uses a fallback font.
    if (document.fonts?.ready) await document.fonts.ready;

    const layout = pdfChooseLayout(preview);
    const W = layout.w;
    const PAGE_H = pdfPageH(W);
    const estH = pdfMeasureLive(preview, W, layout.tight).totalH;
    const renderScale = Math.min(PDF_TARGET_PX / W, Math.sqrt(PDF_MAX_CANVAS_PIXELS / (W * estH * 1.05)));

    let measured = null;
    const canvas = await html2canvas(preview, {
      scale: renderScale,
      useCORS: true,
      backgroundColor: '#ffffff',
      windowWidth: 1400, // desktop layout rules, even on a phone
      onclone: (doc) => {
        const el = doc.getElementById('resumePreview');
        // Out of the page layout (a flex panel that squeezes and clips it).
        const host = doc.createElement('div');
        host.style.cssText = `position:absolute;left:0;top:0;width:${W}px;background:#fff;z-index:99999`;
        doc.body.appendChild(host);
        host.appendChild(el);
        pdfStyleResume(el, W, layout.tight);
        pdfBalance(el);
        measured = pdfMeasure(el, W); // measured where it is drawn, so breaks match exactly
        try { measured.text = pdfCollectText(el); } catch (e) { measured.text = []; }
      }
    });

    const s = canvas.width / W; // canvas px per CSS px
    const { cols, pages } = pdfPlan(measured, W);

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4', compress: true });
    const pageWmm = pdf.internal.pageSize.getWidth();
    const pageHmm = pdf.internal.pageSize.getHeight();

    const page = document.createElement('canvas');
    page.width = canvas.width;
    page.height = Math.round(PAGE_H * s);
    const ctx = page.getContext('2d');
    const maxRow = canvas.height - 1;
    const R = (v) => Math.max(0, Math.min(maxRow, Math.round(v)));
    // Fill a column's strip with one stretched pixel row (its background).
    const fillWith = (sx, sw, rowY, dy, dh) => {
      if (dh > 0) ctx.drawImage(canvas, sx, R(rowY), sw, 1, sx, Math.round(dy), sw, Math.ceil(dh));
    };

    for (let n = 0; n < pages; n++) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, page.width, page.height);
      const bandH = n === 0 ? measured.headerH : 0;
      if (bandH) ctx.drawImage(canvas, 0, 0, canvas.width, R(bandH * s), 0, 0, canvas.width, R(bandH * s));

      for (const c of cols) {
        const sx = Math.round(c.x0 * s);
        const sw = Math.max(1, Math.round((c.x1 - c.x0) * s));
        const startY = n === 0 ? (c.top || bandH) : PDF_CONT_TOP; // where this column's text starts on the page
        // A row from the column's bottom padding: plain background.
        const bgRow = (c.top + c.contentH - 4) * s;

        if (n >= c.breaks.length - 1) {
          // This column has finished: just its background, top to bottom.
          fillWith(sx, sw, bgRow, n === 0 ? bandH * s : 0, page.height);
          continue;
        }
        const from = c.breaks[n];
        const to = c.breaks[n + 1];
        const srcY = (c.top + from.y) * s;
        const srcH = Math.max(1, (to.y - from.y) * s);
        const isLast = n === c.breaks.length - 2;

        // Top margin on continued pages.
        if (n > 0) fillWith(sx, sw, from.clean ? srcY : bgRow, 0, startY * s);
        ctx.drawImage(canvas, sx, R(srcY), sw, Math.max(1, Math.min(srcH, canvas.height - R(srcY))), sx, Math.round(startY * s), sw, Math.round(srcH));
        // Below the content to the bottom edge, in the column's colour.
        const below = startY * s + srcH;
        fillWith(sx, sw, isLast ? bgRow : (to.clean ? srcY + srcH - 1 : bgRow), below, page.height - below);
      }

      if (n > 0) pdf.addPage();
      pdf.addImage(page.toDataURL('image/png'), 'PNG', 0, 0, pageWmm, pageHmm, undefined, 'FAST');
    }

    const data = stripSensitiveItems(window.__viewedResumeData || collectFormData());
    const name = [data.personal?.firstname, data.personal?.lastname].filter(Boolean).join(' ');

    // Page numbers (sharp vector text) when there is more than one page.
    if (pages > 1) {
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(7.5);
      pdf.setTextColor(148, 163, 184);
      for (let n = 1; n <= pages; n++) {
        pdf.setPage(n);
        const label = `${name ? name.replace(/[^\x20-\x7E\xA0-\xFF]/g, '') + '  ·  ' : ''}Page ${n} of ${pages}`;
        pdf.text(label, pageWmm - 9, pageHmm - 5.5, { align: 'right' });
      }
      pdf.setTextColor(0, 0, 0);
    }

    // Selectable text exactly over the words in the picture; the old
    // single block of hidden text is only a fallback.
    const placed = addAlignedTextLayer(pdf, measured, cols, W);
    if (!placed) addPdfTextLayer(pdf, data);
    pdf.setProperties({
      title: name ? `${name} — Resume` : 'Resume',
      author: name || '',
      subject: 'Resume',
      keywords: (data.skills || []).map(sk => sk.skill).filter(Boolean).join(', '),
      creator: 'Taimur Resume'
    });

    pdf.save(`${pdfFileBase(data)}.pdf`);
    pdfLengthToast(pages, data);

  } catch (err) {
    console.error('PDF export failed:', err);
    showToast('❌ Could not generate PDF — try Print instead', 'error');
  } finally {
    restoreBtn();
  }
}

// Breaks for one column, as { y, clean } in px from the column's top
// (clean = in a gap between lines). firstRoom / nextRoom: how much fits on
// the first / later pages above the bottom margin. The last page needs no
// bottom margin, since the column ends there.
function pdfColumnBreaks(contentH, lines, items, firstRoom, nextRoom) {
  const clearSpot = (ideal, boxes) => {
    let y = ideal;
    for (let guard = 0; guard < 400; guard++) {
      const hit = boxes.find(([t, b]) => t < y - 0.5 && b > y + 0.5);
      if (!hit) return y;
      y = hit[0] - 2;
    }
    return y;
  };
  const all = lines.concat(items);
  const breaks = [{ y: 0, clean: true }];
  let start = 0;
  for (let guard = 0; guard < 50; guard++) {
    const room = breaks.length === 1 ? firstRoom : nextRoom;
    if (contentH - start <= room + PDF_BOTTOM + 1) break;
    const ideal = start + room;
    // Best: whole entries and short sections together, even if that leaves
    // up to half a page empty.
    let y = clearSpot(ideal, all);
    // Otherwise (one very long entry): at least don't cut a line of text.
    if (y < ideal - room * 0.5) y = clearSpot(ideal, lines);
    let clean = true;
    // Nothing sensible (e.g. one huge block): cut at the page edge.
    if (y < ideal - room * 0.6) { y = ideal; clean = false; }
    breaks.push({ y, clean });
    start = y;
  }
  breaks.push({ y: contentH, clean: true });
  return breaks;
}

// Puts each line of text, invisible, exactly where the picture shows it:
// same page, position, height and width. Selecting in a PDF viewer then
// highlights the right words; copy, search (Ctrl+F) and ATS systems read
// real text. This is how searchable scanned PDFs work. Returns how many
// lines were placed.
function addAlignedTextLayer(pdf, measured, cols, W) {
  const segs = measured?.text || [];
  if (!segs.length) return 0;
  const k = pdf.internal.pageSize.getWidth() / W; // mm per CSS px
  const bandH = measured.headerH || 0;
  const PT_PER_MM = 72 / 25.4;
  pdf.setFont('helvetica', 'normal');
  let placed = 0;

  // Which page a piece of text lands on, and where (CSS px on that page).
  const locate = (s) => {
    const mid = s.y + s.h / 2;
    if (bandH && mid < bandH) return { page: 0, x: s.x, y: s.y };
    const c = cols.find(col => s.x + 1 >= col.x0 && s.x < col.x1 && mid >= col.top) || cols[0];
    const cy = s.y - c.top;
    const cmid = mid - c.top;
    for (let n = 0; n < c.breaks.length - 1; n++) {
      if (cmid >= c.breaks[n].y && cmid < c.breaks[n + 1].y) {
        const startY = n === 0 ? (c.top || bandH) : PDF_CONT_TOP;
        return { page: n, x: s.x, y: startY + (cy - c.breaks[n].y) };
      }
    }
    return null;
  };

  for (const s of segs) {
    const t = pdfLatin1(s.t);
    if (!t) continue;
    const at = locate(s);
    if (!at) continue;
    const sizePt = s.fs * k * PT_PER_MM;
    if (sizePt < 2) continue;
    pdf.setPage(at.page + 1);
    pdf.setFontSize(sizePt);
    const natural = pdf.getTextWidth(t);
    if (!natural) continue;
    // Baseline sits about 78% down the line box.
    pdf.text(t, at.x * k, (at.y + s.h * 0.78) * k, {
      renderingMode: 'invisible',
      horizontalScale: Math.max(0.3, Math.min(3, (s.w * k) / natural))
    });
    placed++;
  }
  pdf.setPage(pdf.internal.getNumberOfPages());
  return placed;
}

// Invisible text with the resume's words (same text as Export → Plain text),
// so the PDF can be searched, copied and read by applicant tracking systems.
// Used only if the aligned layer above couldn't be built.
function addPdfTextLayer(pdf, data) {
  if (typeof buildResumeText !== 'function') return;
  let text;
  try { text = buildResumeText(data); } catch (e) { return; }
  // The built-in PDF font only covers Latin-1; swap common symbols, drop the rest.
  text = text
    .replace(/[–—]/g, '-').replace(/[•·]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '');
  const pageCount = pdf.internal.getNumberOfPages();
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8);
  const lines = pdf.splitTextToSize(text, pdf.internal.pageSize.getWidth() - 20);
  const perPage = Math.floor((pdf.internal.pageSize.getHeight() - 20) / 3.2);
  for (let p = 0; p * perPage < lines.length; p++) {
    pdf.setPage(Math.min(p + 1, pageCount));
    pdf.text(lines.slice(p * perPage, (p + 1) * perPage), 10, 10, { renderingMode: 'invisible', lineHeightFactor: 1.15 });
  }
  pdf.setPage(pageCount);
}
