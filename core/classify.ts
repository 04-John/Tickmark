// Place every paid movement in a chart of accounts, and say why.
//
// Rules run in a fixed order and stop at the first that applies:
//   1. what the chain shows (money moved to the treasury itself, NEAR wrapped or staked, a Trezu swap, a protocol deposit);
//   2. words a person wrote in the proposal ("invoice", "grant", "honorarium"...);
//   3. the payee: another DAO, or an account an earlier payment already placed;
//   4. otherwise Suspense, with a question for the treasurer.
// Every placement keeps its evidence, so a bookkeeper can check it and overrule it.
import { BULK_PAYMENT_CONTRACTS } from './decode.ts';
import { parseDescription, trezuAction, type Description } from './describe.ts';
import { KNOWN_TOKENS } from './tokens.ts';
import { bookingTime } from './types.ts';
import type { ValuedMovement } from './value.ts';

export type Section = 'expense' | 'suspense' | 'balance_sheet';

export type CategoryId =
  | 'payroll'
  | 'contractors'
  | 'grants'
  | 'bounties'
  | 'marketing'
  | 'travel'
  | 'infrastructure'
  | 'fees'
  | 'distributions'
  | 'other_daos'
  | 'refunds'
  | 'suspense'
  | 'own_wallets'
  | 'loans'
  | 'exchanges'
  | 'protocols'
  | 'swaps'
  | 'internal';

export type Account = { code: string; name: string };
export type Category = Account & { id: CategoryId; section: Section };

/** The chart of accounts. Codes are stable: exports and imports rely on them. */
export const CATEGORIES: Record<CategoryId, Category> = Object.fromEntries(
  (
    [
      ['payroll', '6010', 'Contributor pay', 'expense'],
      ['contractors', '6020', 'Contractors and services', 'expense'],
      ['grants', '6030', 'Grants', 'expense'],
      ['bounties', '6040', 'Bounties, prizes and rewards', 'expense'],
      ['marketing', '6050', 'Marketing and events', 'expense'],
      ['travel', '6060', 'Travel and reimbursed expenses', 'expense'],
      ['infrastructure', '6070', 'Infrastructure and software', 'expense'],
      ['fees', '6080', 'Network fees and storage', 'expense'],
      ['distributions', '6090', 'Protocol fee and revenue distributions', 'expense'],
      ['other_daos', '6100', 'Funding sent to other DAOs', 'expense'],
      ['refunds', '6110', 'Refunds', 'expense'],
      ['suspense', '1999', 'Suspense (payments to be explained)', 'suspense'],
      ['own_wallets', '1910', "Moved to the organization's other wallets", 'balance_sheet'],
      ['loans', '1950', 'Loans given', 'balance_sheet'],
      ['exchanges', '1920', 'Held at exchanges', 'balance_sheet'],
      ['protocols', '1930', 'Deposited into DeFi protocols', 'balance_sheet'],
      ['swaps', '1940', 'Swaps in transit', 'balance_sheet'],
      ['internal', '1000', 'Moved between the treasury’s own balances', 'balance_sheet'],
    ] as const
  ).map(([id, code, name, section]) => [id, { id, code, name, section }]),
) as Record<CategoryId, Category>;

/** Where the treasury held the money before it moved. */
export type Location = 'wallet' | 'intents' | 'staked';

const LOCATION_PREFIX: Record<Location, { base: number; label: (symbol: string) => string }> = {
  wallet: { base: 1100, label: (s) => `Digital assets: ${s}` },
  intents: { base: 1200, label: (s) => `NEAR Intents balance: ${s}` },
  staked: { base: 1300, label: (s) => `Staked: ${s}` },
};

/** Known tokens get their own asset account (codes x10, x11... in KNOWN_TOKENS order, which is append-only). */
const TOKEN_SLOTS = new Map(Object.keys(KNOWN_TOKENS).map((id, i) => [id, 10 + i]));

/** The asset account for a token at a location. Tokens Tickmark doesn't know share one "other tokens" account per location. */
export function assetAccount(token: string, location: Location): Account {
  const slot = TOKEN_SLOTS.get(token);
  const { base, label } = LOCATION_PREFIX[location];
  if (slot === undefined) return { code: String(base + 90), name: label('other tokens') };
  return { code: String(base + slot), name: label(KNOWN_TOKENS[token]!.symbol) };
}

/** Where the money came from: the Intents balance for Intents calls and Intents-funded bulk lists, the wallet otherwise. */
export function sourceLocation(m: ValuedMovement): Location {
  if (m.via === 'intents_transfer' || m.via === 'intents_withdraw') return 'intents';
  if (m.via === 'bulk_payment' && m.method === 'mt_transfer_call') return 'intents';
  return 'wallet';
}

/** How a placement was decided: what the chain or the proposal type shows, a person's words, the payee's history, or nothing. */
export type Basis = 'chain' | 'account_name' | 'memo' | 'payee_history' | 'none';

export type RuleId =
  | 'to_self'
  | 'own_name'
  | 'wrap_near'
  | 'stake_near'
  | 'storage_deposit'
  | 'trezu_asset_exchange'
  | 'into_protocol'
  | 'memo_words'
  | 'other_dao'
  | 'payee_history'
  | 'unreadable_bulk_list'
  | 'unexplained';

/** A token held in one place. */
export type Holding = { token: string; location: Location };

export type Booking = {
  category: CategoryId;
  /** The account debited: the category, or for money moved within the treasury the asset account it moved into. */
  debit: Account;
  /** The asset account the money left. */
  credit: Account;
  /** What left, and from where (for checking balances against the chain). */
  from: Holding;
  /** For moves within the treasury: what arrived, and where (wNEAR for wrapped NEAR, the Intents balance for a deposit...). */
  into?: Holding;
  rule: RuleId;
  basis: Basis;
  /** Why, in words a bookkeeper can check. */
  evidence: string;
};

export type Classified = ValuedMovement & {
  /** Who was paid: the recipient a Trezu payment names, otherwise the account the money went to on chain. */
  payee: string;
  /** What a person wrote in the proposal, without Trezu's machine fields. */
  memoText: string;
  /** Null for movements that were not paid (rejected, failed, expired, pending). */
  booking: Booking | null;
  /** The category the rules give this movement, paid or not (an unpaid swap is still a swap). Payee history is not used. */
  intended: CategoryId;
};

/** Words that place a payment, checked in this order; the first category with a match wins. */
const WORDS: [CategoryId, RegExp][] = [
  ['refunds', /\brefund(s|ed)?\b/i],
  ['loans', /\b(loans?|drawdowns?)\b/i],
  ['own_wallets', /\b(multi-?sig|cold wallet|hot wallet|own wallet|top[ -]?up|rebalanc\w*)\b/i],
  ['exchanges', /\b(kraken|binance|coinbase|okx|bybit|kucoin|bitget|gate\.io|htx|huobi|bitfinex|upbit)\b/i],
  ['distributions', /\b(protocol fees?|revenue share|buy-?backs?|fee distributions?)\b/i],
  ['grants', /\b(grants?|grantees?|funding round)\b/i],
  ['bounties', /\b(bount(y|ies)|prizes?|hackathons?|rewards?|winners?|contests?|competitions?|airdrops?|incentives?)\b/i],
  ['payroll', /\b(salar(y|ies)|payroll|compensation|remuneration|stipends?|honorari(um|a)|wages?)\b/i],
  ['contractors', /\b(invoices?|contractors?|consult(ing|ants?)|services?|development|design|audits?|legal|accounting|retainer)\b|\binv(?=\d|\.|\b)/i],
  ['travel', /\b(travel|flights?|hotels?|accommodation|reimburse(ment|ments|d)?|expenses?)\b/i],
  ['infrastructure', /\b(hosting|servers?|infrastructure|rpc|subscriptions?|software|licen[cs]es?|cloud|domains?)\b/i],
  ['marketing', /\b(marketing|events?|conferences?|sponsor(s|ship)?|catering|food|drinks?|merch|advertising|campaigns?)\b/i],
  ['fees', /\b(network fees?|gas fees?|storage)\b/i],
];

const STAKING_POOL = /\.(poolv1|pool|poolv2)\.near$|\.pool\.f863973\.m0$/;
const STAKE_METHODS = new Set(['deposit_and_stake', 'deposit', 'stake']);
const short = (account: string) => (/^[0-9a-f]{64}$/.test(account) ? `${account.slice(0, 6)}…${account.slice(-4)}` : account);
const fmt = (quantity: string) => Number(quantity).toLocaleString('en-US', { maximumFractionDigits: 6 });

/** Accounts made by the Sputnik DAO factories: x.sputnik-dao.near on mainnet, x.sputnik-v2.testnet (and older names) on testnet. */
const SPUTNIK_DAO = /^([^.]+)\.(sputnik-dao\.near|sputnik-v2\.testnet|sputnikv2\.testnet|sputnik-dao\.testnet)$/;

export function isSputnikDao(account: string): boolean {
  return SPUTNIK_DAO.test(account);
}

/** True when the payee is the DAO's own name on the plain registry: x.near for x.sputnik-dao.near, x.testnet on testnet. */
export function sameNameAccount(dao: string, payee: string): boolean {
  const m = SPUTNIK_DAO.exec(dao);
  return Boolean(m && payee === `${m[1]}.${m[2]!.endsWith('.near') ? 'near' : 'testnet'}`);
}

function ownNamePlacement(payee: string): Draft {
  return {
    category: 'own_wallets',
    rule: 'own_name',
    basis: 'account_name',
    evidence: `nothing says what it was for, and the payee ${payee} has the DAO's own name, so it is treated as the organization's own account`,
  };
}

/** First matching category for a person's words, with the word that matched. */
export function categoryFromWords(text: string): { category: CategoryId; word: string } | null {
  for (const [category, re] of WORDS) {
    const m = re.exec(text);
    if (m) return { category, word: m[0] };
  }
  return null;
}

type Draft = Omit<Booking, 'debit' | 'credit' | 'from'> & { debit?: Account };

/** Rules 1-3a for one movement: everything that doesn't depend on other movements. */
function placeAlone(m: ValuedMovement, d: Description, payee: string): Draft | null {
  const action = trezuAction(d);
  const words = categoryFromWords(d.text);

  if (m.to === m.dao) {
    const into = m.via === 'intents_deposit' ? 'intents' : 'wallet';
    return {
      category: 'internal',
      debit: assetAccount(m.token, into),
      into: { token: m.token, location: into },
      rule: 'to_self',
      basis: 'chain',
      evidence: into === 'intents' ? 'deposited into the treasury’s own NEAR Intents balance' : 'sent to the treasury itself',
    };
  }
  if (m.via === 'attached_deposit' && m.to === 'wrap.near' && m.method === 'near_deposit') {
    return { category: 'internal', debit: assetAccount('wrap.near', 'wallet'), into: { token: 'wrap.near', location: 'wallet' }, rule: 'wrap_near', basis: 'chain', evidence: 'near_deposit on wrap.near turns NEAR into the same amount of wNEAR' };
  }
  if (m.via === 'attached_deposit' && (STAKING_POOL.test(m.to) || action === 'stake') && STAKE_METHODS.has(m.method ?? '')) {
    return { category: 'internal', debit: assetAccount('near', 'staked'), into: { token: 'near', location: 'staked' }, rule: 'stake_near', basis: 'chain', evidence: `${m.method} on staking pool ${m.to}` };
  }
  if (m.via === 'attached_deposit' && m.method === 'storage_deposit') {
    return { category: 'fees', rule: 'storage_deposit', basis: 'chain', evidence: `storage_deposit on ${m.to}: NEAR locked for the treasury’s storage there` };
  }
  if (action === 'asset-exchange') {
    const out = d.fields['amount out'] && d.fields['token out address'] ? `, for about ${d.fields['amount out']} of ${d.fields['token out address'].replace(/^nep141:/, '')} (1Click quote)` : '';
    return { category: 'swaps', rule: 'trezu_asset_exchange', basis: 'chain', evidence: `Trezu asset exchange: ${fmt(m.quantity)} ${m.symbol} sent to 1Click deposit address ${short(m.to)}${out}` };
  }
  if (m.via === 'bulk_payment' && BULK_PAYMENT_CONTRACTS.has(m.to)) {
    return { category: 'suspense', rule: 'unreadable_bulk_list', basis: 'none', evidence: m.note ?? 'the bulk payment list could not be read' };
  }
  if (m.via === 'ft_transfer_call') {
    return { category: 'protocols', rule: 'into_protocol', basis: 'chain', evidence: `ft_transfer_call sent the tokens into contract ${m.to}` };
  }
  if (words) {
    const cat = CATEGORIES[words.category];
    return { category: words.category, rule: 'memo_words', basis: 'memo', evidence: `the proposal says “${words.word}” → ${cat.name}` };
  }
  if (isSputnikDao(payee)) {
    return { category: 'other_daos', rule: 'other_dao', basis: 'chain', evidence: `the payee ${payee} is another Sputnik DAO` };
  }
  return null;
}

/**
 * Classifies every movement. Unpaid movements get no booking.
 * Suspense items whose payee was placed elsewhere by a person's words inherit that category (basis "payee_history"),
 * but only when all those earlier placements agree.
 */
export function classify(movements: ValuedMovement[]): Classified[] {
  const drafts = movements.map((m) => {
    const d = parseDescription(m.memo);
    // A Trezu payment names its recipient; on chain the money goes to a 1Click deposit address that forwards it.
    // The named recipient is the payee only for the line that went to that deposit address.
    const recipient = trezuAction(d) === 'payment-transfer' ? d.fields.recipient?.trim() : undefined;
    const forwarded = Boolean(recipient && recipient !== m.to && d.fields['deposit address']?.trim() === m.to);
    const payee = forwarded ? recipient! : m.to;
    const draft = placeAlone(m, d, payee);
    const via = forwarded ? `Trezu payment to ${recipient}${networkNote(d)} through deposit address ${short(m.to)}; ` : '';
    return { m, d, payee, draft, via };
  });

  // Payee history: categories that a person's words gave to each payee.
  const history = new Map<string, { category: CategoryId; proposalId: number; word: string }[]>();
  for (const { m, payee, draft } of drafts) {
    if (!m.executed || draft?.basis !== 'memo' || CATEGORIES[draft.category].section !== 'expense') continue;
    const list = history.get(payee) ?? [];
    list.push({ category: draft.category, proposalId: m.proposalId, word: draft.evidence });
    history.set(payee, list);
  }

  return drafts.map(({ m, d, payee, draft, via }) => {
    const base = { ...m, payee, memoText: d.text, intended: draft?.category ?? (sameNameAccount(m.dao, payee) ? 'own_wallets' : 'suspense') };
    if (!m.executed) return { ...base, booking: null };
    let placed: Draft = draft ?? { category: 'suspense', rule: 'unexplained', basis: 'none', evidence: d.text ? 'the proposal does not say what the payment was for' : 'the proposal has no description' };
    if (!draft) {
      const seen = history.get(payee) ?? [];
      const categories = new Set(seen.map((h) => h.category));
      if (categories.size === 1) {
        const first = seen.find((h) => h.proposalId !== m.proposalId) ?? seen[0]!;
        placed = {
          category: first.category,
          rule: 'payee_history',
          basis: 'payee_history',
          evidence: `nothing in this proposal says what it was for; #${first.proposalId} paid ${payee} as ${CATEGORIES[first.category].name} (${first.word.split(' → ')[0]})`,
        };
      } else if (categories.size > 1) {
        placed = { ...placed, evidence: `${placed.evidence}; earlier payments to ${payee} were placed in ${[...categories].map((c) => CATEGORIES[c].name).join(' and ')}` };
      } else if (sameNameAccount(m.dao, payee)) {
        // Weakest inference, so it comes last: a person can own the account named like the DAO.
        placed = ownNamePlacement(payee);
      }
    }
    const category = CATEGORIES[placed.category];
    const booking: Booking = {
      category: placed.category,
      debit: placed.debit ?? { code: category.code, name: category.name },
      credit: assetAccount(m.token, sourceLocation(m)),
      from: { token: m.token, location: sourceLocation(m) },
      into: placed.into,
      rule: placed.rule,
      basis: placed.basis,
      evidence: via + placed.evidence,
    };
    return { ...base, booking };
  });
}

function networkNote(d: Description): string {
  const network = d.fields['destination network'];
  return network && network !== 'near.com' ? ` on ${network}` : '';
}

/** Paid movements in booking order, for statements. */
export function paidInOrder(items: Classified[]): Classified[] {
  return items.filter((c) => c.booking).sort((a, b) => bookingTime(a) - bookingTime(b) || a.proposalId - b.proposalId || a.line - b.line);
}
