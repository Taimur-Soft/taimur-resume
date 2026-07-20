// ======================================================
// PDF Export Module
// Renders #resumePreview to a canvas (html2canvas) and lays it into a
// paginated A4 PDF (jsPDF). Falls back to the existing browser
// print-to-PDF flow if either library fails to load (e.g. offline).
// ======================================================

async function exportPDF() {
  const btn = document.getElementById('downloadPdfBtn');
  const preview = document.getElementById('resumePreview');

  if (!preview || !preview.innerHTML.trim()) {
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
    const canvas = await html2canvas(preview, {
      scale: 2, // sharper output than the CSS pixel size
      useCORS: true,
      backgroundColor: '#ffffff'
    });

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();

    const imgWidth = pageWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    const imgData = canvas.toDataURL('image/jpeg', 0.95);

    // Slice the tall single image across as many A4 pages as needed by
    // shifting its vertical offset each time, rather than trying to
    // reflow the actual HTML (much simpler and matches what's on screen).
    let heightLeft = imgHeight;
    let position = 0;

    pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;

    while (heightLeft > 0) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }

    const data = window.__viewedResumeData || collectFormData();
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
