// Exact conversions between raw on-chain integers and decimal amounts.

/** Raw integer amount to an exact decimal string, e.g. ("1500000", 6) -> "1.5". */
export function formatUnits(raw: string | bigint, decimals: number): string {
  const value = BigInt(raw);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = abs % base;
  let out = whole.toString();
  if (decimals > 0 && frac > 0n) out += '.' + frac.toString().padStart(decimals, '0').replace(/0+$/, '');
  return negative ? '-' + out : out;
}

/** Raw integer amount as a float, for USD arithmetic only (exact up to about 15 significant digits). */
export function toNumber(raw: string | bigint, decimals: number): number {
  return Number(formatUnits(raw, decimals));
}

/** Nanosecond timestamp string (Sputnik's submission_time) to Unix milliseconds. */
export function nsToMs(ns: string): number {
  return Number(BigInt(ns) / 1_000_000n);
}

/** UTF-8 safe base64 of a string, in Node and browsers. */
export function toBase64(text: string): string {
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Parse base64-encoded JSON (function-call args). Returns null when it isn't JSON. */
export function parseBase64Json(b64: string): unknown {
  try {
    const binary = atob(b64);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}
