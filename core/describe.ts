// Read a proposal description. Trezu and the Sputnik apps write "* Key: value" lines joined by <br>;
// older proposals are free text. Tickmark keeps both: structured fields for the rules, and the human note for people.

export type Description = {
  /** Lowercased field name ("proposal action", "recipient", "amount out"...) to its value. */
  fields: Record<string, string>;
  /** What a person wrote: Title, Summary, Notes, Custom Notes and any free text. Empty when there is none. */
  text: string;
};

/** Fields whose values were written by a person, in the order they are joined into the note. */
const HUMAN_FIELDS = ['title', 'summary', 'notes', 'custom notes', 'description'];

/** Notes that Trezu writes itself, which say nothing about what the money was for. */
const MACHINE_NOTES = [/^\*\*must be executed before .*?\*\*.*$/i, /^confidential .*details (are )?hidden for privacy\.?$/i];

const clean = (s: string) =>
  s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // markdown links -> their text
    .replace(/[ \t]+/g, ' ')
    .trim();

export function parseDescription(raw: string | null | undefined): Description {
  const body = clean(raw ?? '');
  const fields: Record<string, string> = {};
  const free: string[] = [];
  for (const line of body.split('\n')) {
    const m = /^\s*\*\s*([A-Za-z][A-Za-z ]{1,40}?)\s*:\s*(.*)$/.exec(line);
    if (m) fields[m[1]!.toLowerCase()] = m[2]!.trim();
    else if (line.trim()) free.push(line.replace(/^\s*\*\s*/, '').trim());
  }
  const human = HUMAN_FIELDS.map((k) => fields[k] ?? '')
    .filter((v) => v && !MACHINE_NOTES.some((re) => re.test(v)))
    .filter((v, i, all) => all.indexOf(v) === i); // Title and Summary are often the same
  const text = [...human, ...free].join(' — ').replace(/\s+/g, ' ').trim();
  return { fields, text };
}

/** The Trezu "Proposal Action" (payment-transfer, asset-exchange, bulk-payment, stake...), lowercased. */
export function trezuAction(d: Description): string | undefined {
  return d.fields['proposal action']?.toLowerCase();
}
