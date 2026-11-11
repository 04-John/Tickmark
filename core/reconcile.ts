// Balances checked against the chain.
//
// For every token in every place the treasury holds it (its wallet, its NEAR Intents balance):
//     opening balance + money that came in − what Tickmark booked as leaving = closing balance
// Opening and closing are read from the chain (opening at the last block before the first day, closing at the
// report's block). What came in is not read, it is what makes the equation hold:
//     other money in = closing − opening + booked out − booked moves in
// Positive: income, donations, swap proceeds or refunds arrived. Near zero: the books tie out.
// Negative: money left in a way no proposal Tickmark read explains, so the treasurer is asked.
import type { Classified, Holding, Location } from './classify.ts';
import { INTENTS_CONTRACT } from './decode.ts';
import type { Question } from './questions.ts';
import type { BlockClient, BlockInfo, ViewClient } from './rpc.ts';
import { formatUnits } from './units.ts';

/** First block of each network; nothing exists before it. */
export const GENESIS_HEIGHT = { mainnet: 9_820_210, testnet: 42_376_888 } as const;

const keyOf = (h: Holding) => `${h.location}:${h.token}`;

/** The last block whose time is before `timeMs` (its state is the balance at that moment). Blocks can be skipped. */
export async function blockBefore(client: BlockClient, timeMs: number, head: BlockInfo, genesis: number): Promise<BlockInfo> {
  if (head.timestampMs < timeMs) return head;
  const at = async (height: number): Promise<BlockInfo> => {
    for (let k = 0; k < 50; k++) {
      try {
        return await client.block(height + k);
      } catch (error) {
        if (!/UNKNOWN_BLOCK|not found/i.test(String((error as Error).message))) throw error;
      }
    }
    throw new Error(`no block found from ${height}`);
  };
  let lo = genesis;
  let hi = head.height;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    const b = await at(mid);
    if (b.timestampMs < timeMs && b.height < hi) lo = b.height;
    else hi = mid;
  }
  return at(lo);
}

/** Client able to read balances at one block (an Rpc pinned with at()). */
export type BalanceClient = ViewClient & { viewAccount(accountId: string): Promise<{ amount: string }> };

/** Raw balances by holding; null when the chain could not be read. An account that didn't exist yet holds 0. */
export async function readHoldings(client: BalanceClient, dao: string, holdings: Holding[]): Promise<Map<string, bigint | null>> {
  const out = new Map<string, bigint | null>();
  const missingAccount = (error: unknown) => /UNKNOWN_ACCOUNT|does not exist|doesn't exist/i.test(String((error as Error).message));
  const read = async (h: Holding, run: () => Promise<bigint>) => {
    try {
      out.set(keyOf(h), await run());
    } catch (error) {
      out.set(keyOf(h), missingAccount(error) ? 0n : null);
    }
  };
  const intents = holdings.filter((h) => h.location === 'intents');
  for (const h of holdings) {
    if (h.location === 'wallet' && h.token === 'near') await read(h, async () => BigInt((await client.viewAccount(dao)).amount));
    else if (h.location === 'wallet') await read(h, async () => BigInt(await client.view<string>(h.token, 'ft_balance_of', { account_id: dao })));
  }
  if (intents.length) {
    const ids = intents.map((h) => (h.token.includes(':') ? h.token : `nep141:${h.token === 'near' ? 'wrap.near' : h.token}`));
    try {
      const balances = await client.view<string[]>(INTENTS_CONTRACT, 'mt_batch_balance_of', { account_id: dao, token_ids: ids });
      intents.forEach((h, i) => out.set(keyOf(h), BigInt(balances[i] ?? '0')));
    } catch (error) {
      for (const h of intents) out.set(keyOf(h), missingAccount(error) ? 0n : null);
    }
  }
  return out;
}

export type BalanceStatus = 'ties' | 'received' | 'unexplained_outflow' | 'unreadable';

export type BalanceCheck = {
  token: string;
  symbol: string;
  location: Location;
  /** Exact decimal amounts in the token's units; null when not readable. */
  opening: string | null;
  bookedOut: string;
  movedIn: string;
  closing: string | null;
  /** closing − opening + bookedOut − movedIn. */
  otherIn: string | null;
  status: BalanceStatus;
};

/** The holdings the books touch (never staked NEAR, which earns rewards Tickmark doesn't read), plus the wallet's NEAR. */
export function holdingsOf(items: Classified[]): Holding[] {
  const seen = new Map<string, Holding>([[keyOf({ token: 'near', location: 'wallet' }), { token: 'near', location: 'wallet' }]]);
  for (const c of items) {
    if (!c.booking) continue;
    for (const h of [c.booking.from, c.booking.into]) if (h && h.location !== 'staked') seen.set(keyOf(h), h);
  }
  return [...seen.values()].sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
}

/**
 * The check for each holding. A gap is only "unexplained" above a tolerance: 0.5% of what was booked out, and at
 * least 0.01 of a token (10 NEAR for the wallet's NEAR, which also moves with proposal bonds and storage).
 */
export function reconcile(items: Classified[], holdings: Holding[], opening: Map<string, bigint | null>, closing: Map<string, bigint | null>, tokens: Map<string, { symbol: string; decimals: number }>): BalanceCheck[] {
  const out = new Map<string, bigint>();
  const into = new Map<string, bigint>();
  for (const c of items) {
    if (!c.booking) continue;
    const amount = BigInt(c.amount);
    out.set(keyOf(c.booking.from), (out.get(keyOf(c.booking.from)) ?? 0n) + amount);
    if (c.booking.into) into.set(keyOf(c.booking.into), (into.get(keyOf(c.booking.into)) ?? 0n) + amount);
  }
  return holdings.map((h) => {
    const key = keyOf(h);
    const info = tokens.get(h.token) ?? { symbol: h.token, decimals: 0 };
    const fmt = (v: bigint) => formatUnits(v, info.decimals);
    const o = opening.get(key) ?? null;
    const c = closing.get(key) ?? null;
    const bookedOut = out.get(key) ?? 0n;
    const movedIn = into.get(key) ?? 0n;
    const base = { token: h.token, symbol: info.symbol, location: h.location, opening: o === null ? null : fmt(o), bookedOut: fmt(bookedOut), movedIn: fmt(movedIn), closing: c === null ? null : fmt(c) };
    if (o === null || c === null) return { ...base, otherIn: null, status: 'unreadable' };
    const other = c - o + bookedOut - movedIn;
    const unit = 10n ** BigInt(info.decimals);
    const floor = h.token === 'near' && h.location === 'wallet' ? 10n * unit : unit / 100n;
    const tolerance = bookedOut / 200n > floor ? bookedOut / 200n : floor;
    const abs = other < 0n ? -other : other;
    const status: BalanceStatus = abs <= tolerance ? 'ties' : other > 0n ? 'received' : 'unexplained_outflow';
    return { ...base, otherIn: fmt(other), status };
  });
}

const PLACE: Record<Location, string> = { wallet: 'wallet', intents: 'NEAR Intents balance', staked: 'staked balance' };

/** One question per holding where money left without a proposal Tickmark could read. */
export function balanceQuestions(checks: BalanceCheck[], since: string, asOfDate: string): Question[] {
  return checks
    .filter((b) => b.status === 'unexplained_outflow')
    .map((b) => {
      const missing = b.otherIn!.replace(/^-/, '');
      return {
        id: `balance_gap:${b.location}:${b.token}`,
        kind: 'balance_gap' as const,
        ask: `About ${Number(missing).toLocaleString('en-US', { maximumFractionDigits: 6 })} ${b.symbol} left the treasury's ${PLACE[b.location]} between ${since} and ${asOfDate} without a proposal Tickmark could read. Where did it go?`,
        facts: [
          `opening ${b.opening} ${b.symbol}, booked out ${b.bookedOut}, moved in from the treasury's other balances ${b.movedIn}, closing ${b.closing}`,
          'possible causes: payments signed with chain signatures, a proposal submitted before the first day and paid after it, a bulk list funded but not fully paid yet, or a call Tickmark does not decode',
        ],
        proposals: [],
        cents: null,
      };
    });
}
