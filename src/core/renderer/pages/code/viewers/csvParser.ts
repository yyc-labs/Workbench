/**
 * Minimal RFC 4180 CSV parser.
 *
 * Supports quoted fields (double-quote escaping), commas and line breaks inside
 * quoted fields, and both CRLF / LF line endings. `parseDelimited` reuses it for
 * comma-delimited data and falls back to a simple tab split for TSV files.
 */

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i]
    if (inQuotes) {
      if (char === '"') {
        if (normalized[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
    } else if (char === '"' && field === '') {
      inQuotes = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }

  // Push the final record if the input does not end with a line break.
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows
}

export function parseDelimited(text: string, delimiter: ',' | '\t'): string[][] {
  if (delimiter === ',') return parseCsv(text)

  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  if (!normalized) return []
  return normalized.split('\n').map((line) => line.split('\t'))
}
