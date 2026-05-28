import * as pdfjsLib from 'pdfjs-dist';

// Point PDF.js at its bundled worker. Vite resolves the ?url import at build time.
// This must run once before any PDF is loaded.
let workerInitialised = false;
function initWorker() {
  if (workerInitialised) return;
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).href;
  workerInitialised = true;
}

/**
 * Render each page of a PDF File/Blob into a base64 JPEG string.
 * @param {File} file        — the PDF file
 * @param {number} scale     — render scale (1.5 = good balance of quality vs size)
 * @param {number} quality   — JPEG quality 0–1
 * @returns {Promise<string[]>} — array of base64 strings, one per page
 */
export async function pdfToPageImages(file, { scale = 1.5, quality = 0.85 } = {}) {
  initWorker();

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const images = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width  = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);

    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;

    // Strip the "data:image/jpeg;base64," prefix — only the raw base64 is needed
    const base64 = canvas.toDataURL('image/jpeg', quality).split(',')[1];
    images.push(base64);

    // Release page resources to keep memory usage flat
    page.cleanup();
    canvas.width  = 0;
    canvas.height = 0;
  }

  await pdf.destroy();
  return images;
}

/** Returns the number of pages in a PDF without rendering anything. */
export async function getPdfPageCount(file) {
  initWorker();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const count = pdf.numPages;
  await pdf.destroy();
  return count;
}

/**
 * Extract all readable text from a PDF using PDF.js's text layer.
 * Works for digitally-created PDFs (the vast majority of bank statements).
 * Returns an empty string for scanned/image-only PDFs.
 *
 * The returned text is typically 20–100 KB even for 9 MB PDFs — completely
 * avoiding Vercel's 4.5 MB serverless request body limit.
 */
export async function extractPdfText(file) {
  initWorker();

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pageTexts = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();

    // Sort text items by vertical position (top → bottom) so table rows
    // come out in reading order regardless of internal PDF object order.
    const sorted = [...content.items].sort((a, b) => {
      const yDiff = b.transform[5] - a.transform[5]; // descending y (PDF coords are bottom-up)
      return Math.abs(yDiff) > 2 ? yDiff : a.transform[4] - b.transform[4]; // then left→right
    });

    // Group items into lines (same y position ± 2 units)
    const lines = [];
    let currentLine = [];
    let lastY = null;
    for (const item of sorted) {
      const y = item.transform[5];
      if (lastY === null || Math.abs(y - lastY) > 2) {
        if (currentLine.length) lines.push(currentLine.map(i => i.str).join(' '));
        currentLine = [item];
      } else {
        currentLine.push(item);
      }
      lastY = y;
    }
    if (currentLine.length) lines.push(currentLine.map(i => i.str).join(' '));

    pageTexts.push(`--- Page ${pageNum} ---\n${lines.join('\n')}`);
    page.cleanup();
  }

  await pdf.destroy();
  return pageTexts.join('\n\n');
}
