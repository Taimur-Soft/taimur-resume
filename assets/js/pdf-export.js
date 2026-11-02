// ======================================================
// PDF Export Module
// Renders the resume (html2canvas) into a paginated A4 PDF (jsPDF).
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
// - Fit to pages: if a slightly wider layout saves a page, it is used.
// - Pages that continue get top/bottom margins; backgrounds and sidebars
//   run to the bottom edge of every page; page numbers on multi-page CVs.
// Quality: ~250 DPI, lossless PNG, plus an invisible text layer so ATS
// systems (and copy/paste) can read the words.
// Falls back to the browser's print-to-PDF if the libraries fail to load.
// ======================================================

const PDF_WIDTHS = [600, 640, 690];           // layout widths tried, in CSS px across A4
const PDF_TARGET_PX = 2100;                   // ≈ 250 DPI across A4
const PDF_CONT_TOP = 30;                      // top margin (px) on pages after the first
const PDF_BOTTOM = 30;                        // bottom margin (px) on pages that continue
const PDF_MAX_CANVAS_PIXELS = 16e6;           // phones (iOS) refuse bigger canvases

const PDF_LINES = 'p, li, h1, h2, h3, h4, h5, h6, tr, img, span, a, strong, small';
const PDF_ITEMS = '.eu-item, .eu-skill, .eu-lang-table, .eu-lang-mother, .eu-skill-tags, .eu-contact-item, .eu-about-text, [class*="item"], table';

const pdfPageH = (w) => Math.round(w * 297 / 210);

// Gives a copy of the resume its PDF size, outside any page layout.
function pdfStyleResume(el, w) {
  Object.assign(el.style, {
    width: w + 'px', maxWidth: w + 'px', minWidth: w + 'px',
    minHeight: pdfPageH(w) + 'px', height: 'auto', flex: 'none',
    fontSize: '11px', boxShadow: 'none', borderRadius: '0', margin: '0'
  });
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

// Measures the resume at width w without drawing anything.
function pdfMeasureLive(preview, w) {
  const host = document.createElement('div');
  host.style.cssText = `position:absolute;left:-30000px;top:0;width:${w}px;visibility:hidden;pointer-events:none`;
  const el = preview.cloneNode(true);
  el.removeAttribute('id');
  pdfStyleResume(el, w);
  host.appendChild(el);
  document.body.appendChild(host);
  try { return pdfMeasure(el, w); } finally { host.remove(); }
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

// Narrowest width (largest text) that needs the fewest pages.
function pdfChooseWidth(preview) {
  let best = null;
  for (const w of PDF_WIDTHS) {
    const pages = pdfPlan(pdfMeasureLive(preview, w), w).pages;
    if (!best || pages < best.pages) best = { w, pages };
  }
  return best.w;
}

async function exportPDF() {
  const btn = document.getElementById('downloadPdfBtn');
  const preview = document.getElementById('resumePreview');

  if (!preview || !preview.innerHTML.trim() || preview.querySelector('#previewEmpty:not([style*="none"])')?.offsetParent) {
    showToast('Please fill in your resume first', 'error');
    return;
  }

  if (typeof html2canvas === 'undefined' || typeof window.jspdf === 'undefined') {
    showToast('⚠️ PDF library unavailable — using Print instead', 'info');
    printCV();
    return;
  }

  const originalBtnHTML = btn?.innerHTML;
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating...';
  }

  try {
    // Fonts must be ready, or the canvas uses a fallback font.
    if (document.fonts?.ready) await document.fonts.ready;

    const W = pdfChooseWidth(preview);
    const PAGE_H = pdfPageH(W);
    const estH = pdfMeasureLive(preview, W).totalH;
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
        pdfStyleResume(el, W);
        measured = pdfMeasure(el, W); // measured where it is drawn, so breaks match exactly
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

    const data = window.__viewedResumeData || collectFormData();
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

    addPdfTextLayer(pdf, data);
    pdf.setProperties({
      title: name ? `${name} — Resume` : 'Resume',
      author: name || '',
      subject: 'Resume',
      keywords: (data.skills || []).map(sk => sk.skill).filter(Boolean).join(', '),
      creator: 'Taimur Resume'
    });

    const fileName = [data.personal?.firstname, data.personal?.lastname].filter(Boolean).join('-') || 'resume';
    pdf.save(`${fileName}.pdf`);
    showToast('✅ PDF downloaded!', 'success');

  } catch (err) {
    console.error('PDF export failed:', err);
    showToast('❌ Could not generate PDF — try Print instead', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalBtnHTML;
    }
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

// Invisible text with the resume's words (same text as Export → Plain text),
// so the PDF can be searched, copied and read by applicant tracking systems.
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
