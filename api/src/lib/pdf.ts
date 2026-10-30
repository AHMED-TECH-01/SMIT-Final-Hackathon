/**
 * Minimal, dependency-free PDF 1.4 writer.
 *
 * Only what a payslip needs: one page of Helvetica text at absolute positions.
 * Keeping this in-house means the payslip download is a real PDF without
 * pulling a rendering engine into the API image.
 */
export interface PdfLine {
  text: string
  /** Font size in points. */
  size?: number
  bold?: boolean
  /** Extra vertical space left after this line. */
  gap?: number
}

const PAGE_WIDTH = 595.28
const PAGE_HEIGHT = 841.89
const MARGIN = 48

/** PDF strings are delimited by parentheses and limited to ASCII here. */
function escapeText(value: string): string {
  return value
    .replace(/[^\x20-\x7E]/g, '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
}

export function buildPdf(lines: PdfLine[]): Buffer {
  const parts: string[] = []
  let cursorY = PAGE_HEIGHT - MARGIN

  for (const line of lines) {
    const size = line.size ?? 11
    cursorY -= size
    if (cursorY < MARGIN) break

    parts.push(
      `BT /${line.bold ? 'F2' : 'F1'} ${size} Tf 1 0 0 1 ${MARGIN} ${cursorY.toFixed(2)} Tm (${escapeText(line.text)}) Tj ET`,
    )
    cursorY -= line.gap ?? 4
  }

  const content = parts.join('\n')

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
  ]

  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []

  objects.forEach((body, index) => {
    offsets.push(pdf.length)
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`
  })

  const xrefStart = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`

  // Every character is ASCII after escaping, so one byte per character.
  return Buffer.from(pdf, 'latin1')
}