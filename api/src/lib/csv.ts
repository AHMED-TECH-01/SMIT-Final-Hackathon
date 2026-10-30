/**
 * Minimal CSV reader/writer.
 *
 * Deliberately small: it handles quoted fields, embedded commas, doubled
 * quotes and both line endings — everything a spreadsheet export produces.
 */
export function parseCsv(input: string): { headers: string[]; rows: Record<string, string>[] } {
  const records: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i]

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
      continue
    }

    if (char === '"') {
      inQuotes = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i += 1
      row.push(field)
      field = ''
      if (row.some((value) => value.trim() !== '')) records.push(row)
      row = []
    } else {
      field += char
    }
  }

  row.push(field)
  if (row.some((value) => value.trim() !== '')) records.push(row)

  const [headerRow, ...bodyRows] = records
  if (!headerRow) return { headers: [], rows: [] }

  const headers = headerRow.map((h) => h.trim())

  return {
    headers,
    rows: bodyRows.map((values) => {
      const record: Record<string, string> = {}
      headers.forEach((header, index) => {
        record[header] = (values[index] ?? '').trim()
      })
      return record
    }),
  }
}

function escapeCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.join(',')]
  for (const row of rows) lines.push(row.map(escapeCell).join(','))
  return `${lines.join('\n')}\n`
}