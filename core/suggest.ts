// Suggestions for the payments nothing explains (Suspense), from a model running in a TEE on NEAR AI Cloud.
//
// Rules place what evidence can place; this only looks at what they could not. A suggestion never changes the
// books: it is kept apart from the fingerprinted report (AI output varies run to run, the books must not), and a
// bookkeeper accepts or ignores it. Everything here is pure; the network part lives in cli/near-ai.ts.
import type { JournalEntry } from './books.ts';
import { CATEGORIES, type CategoryId } from './classify.ts';

/** Categories a suggestion may use: every expense, the balance-sheet places, or "unknown". */
export const SUGGESTABLE: CategoryId[] = (Object.keys(CATEGORIES) as CategoryId[]).filter((id) => id !== 'suspense' && id !== 'internal' && id !== 'swaps');

export type SuspenseGroup = {
  payee: string;
  totalCents: number | null;
  lines: { ref: string; date: string; amount: string; usd: string | null; memo: string; proposalId: number }[];
};

/** Suspense lines grouped by payee, largest first, at most `maxGroups` groups of at most `maxLines` lines each. */
export function suspenseGroups(entries: JournalEntry[], maxGroups = 25, maxLines = 8): SuspenseGroup[] {
  const groups = new Map<string, SuspenseGroup>();
  for (const e of entries) {
    if (e.section !== 'suspense') continue;
    const g = groups.get(e.payee) ?? { payee: e.payee, totalCents: null, lines: [] };
    if (e.cents !== null) g.totalCents = (g.totalCents ?? 0) + e.cents;
    g.lines.push({ ref: e.ref, date: e.date, amount: `${e.quantity} ${e.symbol}`, usd: e.cents === null ? null : (e.cents / 100).toFixed(2), memo: e.memo, proposalId: e.proposalId });
    groups.set(e.payee, g);
  }
  return [...groups.values()]
    .sort((a, b) => (b.totalCents ?? -1) - (a.totalCents ?? -1) || a.payee.localeCompare(b.payee))
    .slice(0, maxGroups)
    .map((g) => ({ ...g, lines: g.lines.slice(0, maxLines) }));
}

export type Confidence = 'high' | 'medium' | 'low';

export type Suggestion = {
  payee: string;
  category: CategoryId | 'unknown';
  categoryName: string;
  confidence: Confidence;
  /** Why, based only on the facts sent. */
  reason: string;
  /** What to ask the treasurer to confirm it. */
  question: string;
  refs: string[];
};

/**
 * The messages sent to the model. Only facts Tickmark already holds are sent: payee account, dates, amounts,
 * what the proposals said, and (when given) the treasurer's private notes, which stay inside the encrypted request.
 */
export function buildMessages(dao: string, groups: SuspenseGroup[], privateNotes?: string): { role: 'system' | 'user'; content: string }[] {
  const categories = SUGGESTABLE.map((id) => `${id}: ${CATEGORIES[id].name}`).join('\n');
  const system = [
    'You help a bookkeeper close the books of a NEAR DAO treasury.',
    'For each payee, suggest the most likely account for its unexplained payments, using only the facts given.',
    'Never invent invoices, people, companies or purposes. If the facts do not point to an account, use "unknown".',
    'Account names on NEAR are public names; a name can hint at a purpose (for example "payroll" or "grants") but is never proof, so say so in the reason and keep confidence at most "medium".',
    'Reply with JSON only, in exactly this shape:',
    '{"suggestions":[{"payee":"<payee exactly as given>","category":"<one id from the list, or unknown>","confidence":"high|medium|low","reason":"<one sentence>","question":"<one question for the treasurer>"}]}',
    'Allowed category ids:',
    categories,
  ].join('\n');
  const facts = groups.map((g) => ({
    payee: g.payee,
    total_usd: g.totalCents === null ? null : (g.totalCents / 100).toFixed(2),
    payments: g.lines.map((l) => ({ proposal: l.proposalId, date: l.date, amount: l.amount, usd: l.usd, description: l.memo || '(none)' })),
  }));
  const user = [
    `Treasury: ${dao}`,
    privateNotes ? `The treasurer's private notes (vendor list, agreements). Use them as facts:\n${privateNotes.slice(0, 8000)}` : 'No private notes were given.',
    `Unexplained payments, by payee:\n${JSON.stringify(facts)}`,
  ].join('\n\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/** Parses the model's reply. Anything not in the allowed shape is dropped and reported, never trusted. */
export function parseSuggestions(text: string, groups: SuspenseGroup[]): { suggestions: Suggestion[]; problems: string[] } {
  const problems: string[] = [];
  const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { suggestions: [], problems: ['the reply was not JSON'] };
  }
  const raw = (parsed as { suggestions?: unknown }).suggestions;
  if (!Array.isArray(raw)) return { suggestions: [], problems: ['the reply had no suggestions list'] };
  const byPayee = new Map(groups.map((g) => [g.payee, g]));
  const allowed = new Set<string>([...SUGGESTABLE, 'unknown']);
  const seen = new Set<string>();
  const suggestions: Suggestion[] = [];
  const text1 = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
  for (const item of raw) {
    const s = item as Record<string, unknown>;
    const payee = text1(s.payee, 200);
    const group = byPayee.get(payee);
    if (!group) {
      problems.push(`unknown payee in reply: ${payee || '(empty)'}`);
      continue;
    }
    if (seen.has(payee)) continue;
    const category = text1(s.category, 40);
    if (!allowed.has(category)) {
      problems.push(`${payee}: category "${category}" is not in the chart`);
      continue;
    }
    const confidence = (['high', 'medium', 'low'] as const).find((c) => c === s.confidence) ?? 'low';
    seen.add(payee);
    suggestions.push({
      payee,
      category: category as CategoryId | 'unknown',
      categoryName: category === 'unknown' ? 'Unknown' : CATEGORIES[category as CategoryId].name,
      confidence,
      reason: text1(s.reason, 300) || 'no reason given',
      question: text1(s.question, 300) || `What were the payments to ${payee} for?`,
      refs: group.lines.map((l) => l.ref),
    });
  }
  for (const g of groups) if (!seen.has(g.payee)) problems.push(`no suggestion for ${g.payee}`);
  return { suggestions, problems };
}

/** Practice mode (no key): the same shape, clearly not from a model, never shown as verified. */
export function practiceSuggestions(groups: SuspenseGroup[]): Suggestion[] {
  return groups.map((g) => ({
    payee: g.payee,
    category: 'unknown',
    categoryName: 'Unknown',
    confidence: 'low',
    reason: 'Practice mode: no AI model was called, so nothing was suggested.',
    question: `What were the payments to ${g.payee} for?`,
    refs: g.lines.map((l) => l.ref),
  }));
}

/** One entry of NEAR AI's public model list (GET /v1/model/list). */
export type NearAiModel = { modelId: string; metadata?: { verifiable?: boolean; attestationSupported?: boolean } };

/** The preferred model if NEAR AI lists it as verifiable with attestation; otherwise an error naming the ones that are. */
export function pickTeeModel(models: NearAiModel[], preferred: string): string {
  const tee = models.filter((m) => m.metadata?.verifiable && m.metadata?.attestationSupported).map((m) => m.modelId);
  if (tee.includes(preferred)) return preferred;
  throw new Error(`${preferred} is not a verifiable TEE model on NEAR AI. Verifiable models: ${tee.join(', ') || 'none'}`);
}

/** What the "Verified" panel shows: each check and its result, with the evidence to look up. */
export type Verification = {
  model: string;
  /** The model is listed by NEAR AI as verifiable with attestation. */
  modelListedAsTee: boolean;
  /** Attestation fetched with a fresh random nonce and verified by the SDK (Intel TDX quote, NVIDIA GPU, measurements). */
  attestation: { verified: boolean; nonces: string[]; signer?: string; tcbStatus?: string; gpuEvidence?: string; details: Record<string, unknown> };
  /** The reply was signed by the attested model key, and the signature checked. */
  replySignature: { verified: boolean; kind?: string; signer?: string; signedTextSha256?: string; signature?: string; completionId?: string };
  /** The request was end-to-end encrypted to the attested model key. */
  endToEndEncrypted: boolean;
  /** Tickmark keeps nothing on a server: there is no Tickmark server. */
  storedServerSide: false;
};

/** The suggestions file, kept apart from the fingerprinted report. */
export type SuggestionsFile = {
  format: 'tickmark-suggestions/1';
  /** The report these suggestions were made for. */
  reportFingerprint: string;
  dao: string;
  createdAt: string;
  mode: 'verified' | 'practice';
  suggestions: Suggestion[];
  problems: string[];
  verification: Verification | null;
};
