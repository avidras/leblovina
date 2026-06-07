// Minimal CSV export (no deps). Quotes fields containing comma/quote/newline; objects are
// JSON-stringified. Prepends a UTF-8 BOM so Excel renders non-Latin names correctly.

export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  const cols =
    columns ??
    Array.from(rows.reduce((s, r) => { Object.keys(r).forEach((k) => s.add(k)); return s }, new Set<string>()))
  const esc = (v: unknown): string => {
    if (v == null) return ''
    let s = typeof v === 'object' ? JSON.stringify(v) : String(v)
    if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"'
    return s
  }
  const head = cols.map(esc).join(',')
  const body = rows.map((r) => cols.map((c) => esc(r[c])).join(',')).join('\r\n')
  return head + '\r\n' + body
}

export function downloadCsv(filename: string, rows: Record<string, unknown>[], columns?: string[]): void {
  const blob = new Blob(['﻿' + toCsv(rows, columns)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
