/**
 * "Download this page as a PDF": the page is drawn to an image exactly as it
 * looks on screen, then laid onto landscape A4 pages. Pages break between
 * charts and tables rather than through them.
 *
 * Both libraries are loaded on first use, so nothing here costs a normal page
 * load. Tables show the rows that are visible on screen — the full data is
 * what the Excel export is for.
 */

type Edge = { top: number; bottom: number }

/** A slice may be shrunk by up to this much to fit its page, rather than leave the page half empty. */
const MAX_SHRINK = 1.12

/** The pieces that must not be sliced through, as heights from the page's top. */
function blockEdges(root: HTMLElement): Edge[] {
  const base = root.getBoundingClientRect().top
  const out: Edge[] = []
  const push = (el: Element) => {
    if (el.hasAttribute('data-export-skip')) return
    const r = el.getBoundingClientRect()
    if (r.height > 0) out.push({ top: r.top - base, bottom: r.bottom - base })
  }
  const visit = (el: Element) => {
    // A grid of cards is many blocks, not one tall one.
    if (el.classList.contains('chartgrid')) Array.from(el.children).forEach(push)
    else push(el)
  }
  for (const child of Array.from(root.children)) {
    if (child.hasAttribute('data-export-content')) Array.from(child.firstElementChild?.children ?? []).forEach(visit)
    else visit(child)
  }
  return out
}

/** Page break heights: each as far down as fits, never through a block. */
function pageBreaks(edges: Edge[], totalHeight: number, pageHeight: number): number[] {
  const breaks: number[] = []
  let start = 0
  const straddles = (y: number) => edges.some((e) => e.top < y - 0.5 && e.bottom > y + 0.5)
  while (start + pageHeight < totalHeight - 1) {
    const limit = start + pageHeight * MAX_SHRINK
    const candidates = edges.map((e) => e.bottom).filter((y) => y > start + 40 && y <= limit && !straddles(y))
    // With nothing to break on, a block taller than a page is cut where the page ends.
    const cut = candidates.length ? Math.max(...candidates) : start + pageHeight
    breaks.push(cut)
    start = cut
  }
  return breaks
}

/** Draws the page into a PDF without saving it, so it can be checked. */
export async function renderPagePdf(root: HTMLElement, footer: string) {
  const [{ toJpeg }, { jsPDF }] = await Promise.all([import('html-to-image'), import('jspdf')])

  root.classList.add('exporting')
  try {
    await document.fonts.ready
    // A short timer rather than an animation frame, which a background tab never fires.
    await new Promise((r) => setTimeout(r, 50))

    const width = root.scrollWidth
    const height = root.scrollHeight
    // Browsers cap canvas size; stay well inside it on very tall pages.
    const ratio = Math.max(1, Math.min(2, 15000 / height))
    const background = getComputedStyle(document.body).backgroundColor || '#f6f2ec'

    const dataUrl = await toJpeg(root, {
      pixelRatio: ratio,
      quality: 0.92,
      backgroundColor: background,
      cacheBust: true,
      filter: (node) => !(node instanceof HTMLElement && node.hasAttribute('data-export-skip')),
    })
    const edges = blockEdges(root)

    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('Could not draw the page.'))
      img.src = dataUrl
    })

    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true })
    const pageW = pdf.internal.pageSize.getWidth()
    const pageH = pdf.internal.pageSize.getHeight()
    const margin = 8
    const footerH = 9
    const usableW = pageW - margin * 2
    const mmPerPx = usableW / width
    const sliceMaxPx = (pageH - margin - footerH) / mmPerPx

    const stops = [0, ...pageBreaks(edges, height, sliceMaxPx), height]
    const pages = stops.length - 1

    for (let i = 0; i < pages; i++) {
      const top = stops[i]
      const sliceH = Math.min(stops[i + 1], height) - top
      const canvas = document.createElement('canvas')
      canvas.width = img.width
      canvas.height = Math.max(1, Math.round(sliceH * ratio))
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Could not prepare the PDF page.')
      ctx.drawImage(img, 0, Math.round(top * ratio), img.width, canvas.height, 0, 0, img.width, canvas.height)

      // A slice a little too tall for its page is shrunk to fit, and centred.
      const scale = Math.min(1, sliceMaxPx / sliceH)
      const drawW = usableW * scale
      if (i > 0) pdf.addPage()
      pdf.addImage(
        canvas.toDataURL('image/jpeg', 0.92), 'JPEG',
        margin + (usableW - drawW) / 2, margin, drawW, sliceH * mmPerPx * scale,
      )
      pdf.setFontSize(8)
      pdf.setTextColor(154, 102, 85)
      pdf.text(`${footer}  -  page ${i + 1} of ${pages}`, margin, pageH - 5)
    }

    return pdf
  } finally {
    root.classList.remove('exporting')
  }
}

export async function downloadPagePdf(root: HTMLElement, fileName: string, footer: string): Promise<void> {
  const pdf = await renderPagePdf(root, footer)
  pdf.save(fileName)
}
