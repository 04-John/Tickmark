// CSV that spreadsheets and accounting imports read the same way (RFC 4180), safe to open in Excel.

/** An exact decimal written as a number (for example cents as "-19.99"). */
export type Decimal = { decimal: string };

/** A cell: text is protected against formula injection; numbers and decimals are written as they are. */
export type Cell = string | number | Decimal | null | undefined;

export const decimal = (value: string): Decimal => {
  if (!/^-?\d+(\.\d+)?$/.test(value)) throw new Error(`not a decimal: ${value}`);
  return { decimal: value };
};

/**
 * Text written on chain by anyone (proposal descriptions, account names) could start with "=", "+", "-" or "@"
 * and run as a formula when a spreadsheet opens the file. Such text gets a leading apostrophe (OWASP's advice).
 */
function guard(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function cell(value: Cell): string {
  if (value === null || value === undefined) return '';
  const raw = typeof value === 'number' ? String(value) : typeof value === 'object' ? value.decimal : guard(value);
  return /[",\r\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

/** Rows to CSV with CRLF line ends. `bom` adds the UTF-8 mark Excel needs to show non-ASCII text correctly. */
export function toCsv(header: string[], rows: Cell[][], options: { bom?: boolean } = {}): string {
  const lines = [header, ...rows].map((row) => row.map(cell).join(','));
  return (options.bom ? '﻿' : '') + lines.join('\r\n') + '\r\n';
}
