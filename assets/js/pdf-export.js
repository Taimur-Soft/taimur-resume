// ======================================================
// PDF Export Module
// Renders the resume (html2canvas) into a paginated A4 PDF (jsPDF).
//
// Quality:
// - The resume is laid out at its own A4 size (420 × 594 CSS px, 11px text)
//   and drawn at about 250 DPI, so text is sharp when zoomed or printed.
// - Lossless PNG, no JPEG smudging around letters.
// - Pages break between lines and items, never through a line of text.
// - An invisible text layer carries the resume's words, so ATS systems
//   (and copy/paste) can read the PDF, not just see a picture.
// Falls back to the browser's print-to-PDF if the libraries fail to load.
// ======================================================

const PDF_PAGE_W = 420;                       // CSS px, the preview's A4 width
const PDF_PAGE_H = Math.round(PDF_PAGE_W * 297 / 210); // 594 px, A4 height
const PDF_DPI_SCALE = 5;                      // 420 px × 5 = 2100 px ≈ 250 DPI across A4 (print quality)
const PDF_CONT_TOP = 18;                      // top margin (px) on pages after the first

// A page break never cuts a line of text; if it can, it also keeps whole
// items (a job, a degree...) together.
const PDF_LINES = 'p, li, h1, h2, h3, h4, h5, h6, tr, img, span, a, strong, small';
const PDF_ITEMS = '[class*="item"], [class*="entry"], [class*="tag"], table';
// Phones (iOS especially) refuse canvases over ~16.7 million pixels.
const PDF_MAX_CANVAS_PIXELS = 16e6;

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

    // Long resumes get a slightly lower (still sharp) resolution so the
    // canvas stays within what phones allow.
    const estH = Math.max(PDF_PAGE_H, preview.scrollHeight * (PDF_PAGE_W / Math.max(1, preview.offsetWidth)) * 1.15);
    const renderScale = Math.min(PDF_DPI_SCALE, Math.sqrt(PDF_MAX_CANVAS_PIXELS / (PDF_PAGE_W * estH)));

    let lines = [];
    let items = [];
    const canvas = await html2canvas(preview, {
      scale: renderScale,
      useCORS: true,
      backgroundColor: '#ffffff',
      windowWidth: 1400, // desktop layout rules, even on a phone
      onclone: (doc) => {
        const el = doc.getElementById('resumePreview');
        // Take the resume out of the page layout (a flex panel that squeezes
        // and clips it) and give it its exact A4 size and full height.
        const host = doc.createElement('div');
        host.style.cssText = `position:absolute;left:0;top:0;width:${PDF_PAGE_W}px;background:#fff;z-index:99999`;
        doc.body.appendChild(host);
        host.appendChild(el);
        Object.assign(el.style, {
          width: PDF_PAGE_W + 'px', maxWidth: PDF_PAGE_W + 'px', minWidth: PDF_PAGE_W + 'px',
          minHeight: PDF_PAGE_H + 'px', height: 'auto', flex: 'none',
          fontSize: '11px', boxShadow: 'none', borderRadius: '0', margin: '0'
        });
        // Where text and items sit, so pages can break between them.
        const top = el.getBoundingClientRect().top;
        const boxes = (sel) => [...el.querySelectorAll(sel)]
          .map(n => n.getBoundingClientRect())
          .filter(r => r.height > 0 && r.height < PDF_PAGE_H * 0.5)
          .map(r => [r.top - top, r.bottom - top]);
        lines = boxes(PDF_LINES);
        items = boxes(PDF_ITEMS);
      }
    });

    const scale = canvas.width / PDF_PAGE_W;
    const totalH = canvas.height / scale; // CSS px
    const breaks = pdfPageBreaks(totalH, lines, items);

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4', compress: true });
    const pageWmm = pdf.internal.pageSize.getWidth();
    const pageHmm = pdf.internal.pageSize.getHeight();

    const page = document.createElement('canvas');
    page.width = canvas.width;
    page.height = Math.round(PDF_PAGE_H * scale);
    const ctx = page.getContext('2d');

    for (let i = 0; i < breaks.length - 1; i++) {
      const from = breaks[i];
      const to = breaks[i + 1];
      const topPad = i === 0 ? 0 : PDF_CONT_TOP;
      const srcY = Math.round(from.y * scale);
      const srcH = Math.max(1, Math.min(Math.round((to.y - from.y) * scale), canvas.height - srcY));
      const padH = Math.round(topPad * scale);

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, page.width, page.height);
      // Top margin on continued pages: stretch the first row (a gap between
      // lines) so a coloured sidebar carries on instead of showing white.
      if (padH && from.clean) ctx.drawImage(canvas, 0, srcY, canvas.width, 1, 0, 0, page.width, padH);
      ctx.drawImage(canvas, 0, srcY, canvas.width, srcH, 0, padH, page.width, srcH);
      // Below a break: same with the last row, down to the bottom of the page.
      const usedH = padH + srcH;
      if (usedH < page.height && to.clean) {
        ctx.drawImage(canvas, 0, Math.max(0, srcY + srcH - 1), canvas.width, 1, 0, usedH, page.width, page.height - usedH);
      }

      if (i > 0) pdf.addPage();
      pdf.addImage(page.toDataURL('image/png'), 'PNG', 0, 0, pageWmm, pageHmm, undefined, 'FAST');
    }

    const data = window.__viewedResumeData || collectFormData();
    addPdfTextLayer(pdf, data);
    const name = [data.personal?.firstname, data.personal?.lastname].filter(Boolean).join(' ');
    pdf.setProperties({
      title: name ? `${name} — Resume` : 'Resume',
      author: name || '',
      subject: 'Resume',
      keywords: (data.skills || []).map(s => s.skill).filter(Boolean).join(', '),
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

// Page boundaries (CSS px from the top), e.g. [0, 571, 1150, 1400].
// Each page holds up to one page of content; the break moves up to the
// nearest gap so no line or item is split. Later pages lose PDF_CONT_TOP
// to their top margin.
function pdfPageBreaks(totalH, lines, items) {
  // Highest y at or above `ideal` that cuts none of `boxes`.
  const clearSpot = (ideal, boxes) => {
    let y = ideal;
    for (let guard = 0; guard < 300; guard++) {
      const hit = boxes.find(([t, b]) => t < y - 0.5 && b > y + 0.5);
      if (!hit) return y;
      y = hit[0] - 2;
    }
    return y;
  };
  // Each break: { y, clean } — clean means it sits in a gap between lines.
  const breaks = [{ y: 0, clean: true }];
  let start = 0;
  while (totalH - start > PDF_PAGE_H - (breaks.length > 1 ? PDF_CONT_TOP : 0) + 1) {
    const room = PDF_PAGE_H - (breaks.length > 1 ? PDF_CONT_TOP : 0);
    const ideal = start + room;
    // Best: keep whole items together, if that wastes under a quarter page.
    let y = clearSpot(ideal, lines.concat(items));
    // Otherwise: at least don't cut through a line of text.
    if (y < ideal - room * 0.25) y = clearSpot(ideal, lines);
    let clean = true;
    // Nothing sensible (e.g. one huge block): cut at the page edge.
    if (y < ideal - room * 0.4) { y = ideal; clean = false; }
    breaks.push({ y, clean });
    start = y;
  }
  breaks.push({ y: totalH, clean: true });
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
  pdf.setPage(1);
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
