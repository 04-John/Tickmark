import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classify } from '../core/classify.ts';
import { decodeProposal } from '../core/decode.ts';
import { FinalError } from '../core/http.ts';
import { balanceQuestions, blockBefore, holdingsOf, readHoldings, reconcile, type BalanceClient } from '../core/reconcile.ts';
import type { BlockClient, BlockInfo } from '../core/rpc.ts';
import type { Proposal } from '../core/types.ts';
import type { ValuedMovement } from '../core/value.ts';
import * as fx from './fixtures/proposals.ts';

const USDC = '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64');
const near = (n: number) => BigInt(n) * 10n ** 24n;
const usdc = (n: number) => BigInt(n) * 10n ** 6n;
const tokens = new Map([
  ['near', { symbol: 'NEAR', decimals: 24 }],
  ['wrap.near', { symbol: 'wNEAR', decimals: 24 }],
  [USDC, { symbol: 'USDC', decimals: 6 }],
]);

function valued(p: Proposal): ValuedMovement[] {
  return decodeProposal(fx.DAO, p).map((m) => {
    const t = tokens.get(m.token)!;
    return { ...m, symbol: t.symbol, decimals: t.decimals, quantity: '0', unitPrice: null, usd: null, priceDate: null };
  });
}

// Paid 100 NEAR to a designer, wrapped 50 NEAR and paid the 50 wNEAR to an auditor, paid 750 USDC.
const items = classify(
  [
    { ...fx.nativeTransfer, kind: { Transfer: { token_id: '', receiver_id: 'designer.near', amount: near(100).toString(), msg: null } } },
    {
      ...fx.nativeTransfer,
      id: 2,
      kind: {
        FunctionCall: {
          receiver_id: 'wrap.near',
          actions: [
            { method_name: 'near_deposit', args: b64({}), deposit: near(50).toString(), gas: '0' },
            { method_name: 'ft_transfer', args: b64({ receiver_id: 'auditor.near', amount: near(50).toString() }), deposit: '1', gas: '0' },
          ],
        },
      },
    },
    { ...fx.usdcTransfer, id: 3, description: 'Invoice 9' },
  ].flatMap(valued),
);

test('the holdings the books touch, always including the wallet’s NEAR', () => {
  assert.deepEqual(holdingsOf(items), [
    { token: USDC, location: 'wallet' },
    { token: 'near', location: 'wallet' },
    { token: 'wrap.near', location: 'wallet' },
  ]);
  assert.deepEqual(holdingsOf([]), [{ token: 'near', location: 'wallet' }]);
});

test('opening − out + in + other = closing; a gap above tolerance is money that left unseen', () => {
  const holdings = holdingsOf(items);
  const opening = new Map<string, bigint | null>([
    [`wallet:near`, near(1000)],
    [`wallet:wrap.near`, 0n],
    [`wallet:${USDC}`, usdc(5000)],
  ]);
  const closing = new Map<string, bigint | null>([
    [`wallet:near`, near(853) + 10n ** 23n], // 1000 − 150 = 850, plus 3.1 NEAR of bonds and storage: within 10 NEAR
    [`wallet:wrap.near`, 0n], // 50 wrapped in, 50 paid out
    [`wallet:${USDC}`, usdc(3300)], // 5000 − 750 = 4250, but only 3300 left: 950 USDC unexplained
  ]);
  const checks = reconcile(items, holdings, opening, closing, tokens);
  const by = new Map(checks.map((c) => [c.symbol, c]));
  assert.deepEqual([by.get('NEAR')!.bookedOut, by.get('NEAR')!.otherIn, by.get('NEAR')!.status], ['150', '3.1', 'ties']);
  assert.deepEqual([by.get('wNEAR')!.movedIn, by.get('wNEAR')!.bookedOut, by.get('wNEAR')!.status], ['50', '50', 'ties']);
  assert.deepEqual([by.get('USDC')!.otherIn, by.get('USDC')!.status], ['-950', 'unexplained_outflow']);

  const received = reconcile(items, holdings, opening, new Map([...closing, [`wallet:${USDC}`, usdc(9300)]]), tokens);
  assert.equal(received.find((c) => c.symbol === 'USDC')!.status, 'received', 'more than expected: income arrived');
  const unreadable = reconcile(items, holdings, new Map([...opening, [`wallet:${USDC}`, null]]), closing, tokens);
  assert.deepEqual([unreadable.find((c) => c.symbol === 'USDC')!.status, unreadable.find((c) => c.symbol === 'USDC')!.otherIn], ['unreadable', null]);

  const [q, ...rest] = balanceQuestions(checks, '2026-01-01', '2026-11-11');
  assert.equal(rest.length, 0);
  assert.equal(q!.ask, "About 950 USDC left the treasury's wallet between 2026-01-01 and 2026-11-11 without a proposal Tickmark could read. Where did it go?");
});

test('balances are read per place: NEAR from the account, tokens with ft_balance_of, Intents in one batch; a missing account holds 0', async () => {
  const calls: string[] = [];
  const client: BalanceClient = {
    async viewAccount() {
      throw new FinalError('UNKNOWN_ACCOUNT {"requested_account_id":"acme.sputnik-dao.near"}');
    },
    async view<T>(account: string, method: string, args: any) {
      calls.push(`${account}.${method}`);
      if (method === 'ft_balance_of') return '42' as T;
      if (method === 'mt_batch_balance_of') {
        assert.deepEqual(args.token_ids, [`nep141:${USDC}`, 'nep141:wrap.near']);
        return ['7', '8'] as T;
      }
      throw new Error('unexpected');
    },
  };
  const got = await readHoldings(client, fx.DAO, [
    { token: 'near', location: 'wallet' },
    { token: USDC, location: 'wallet' },
    { token: USDC, location: 'intents' },
    { token: 'wrap.near', location: 'intents' },
  ]);
  assert.deepEqual([...got], [
    ['wallet:near', 0n],
    [`wallet:${USDC}`, 42n],
    [`intents:${USDC}`, 7n],
    ['intents:wrap.near', 8n],
  ]);
  assert.equal(calls.filter((c) => c.endsWith('mt_batch_balance_of')).length, 1);
});

test('the opening block is the last one before the first day, even when blocks are skipped', async () => {
  // Blocks 100..400, one per second from t0, with every 7th height missing.
  const t0 = Date.parse('2026-01-01T00:00:00Z') - 250_000;
  let reads = 0;
  const chain: BlockClient = {
    async block(ref) {
      reads++;
      const h = ref as number;
      if (h % 7 === 0 || h < 100 || h > 400) throw new FinalError('UNKNOWN_BLOCK');
      return { height: h, hash: `h${h}`, timestampMs: t0 + (h - 100) * 1000 };
    },
  };
  const head: BlockInfo = { height: 400, hash: 'h400', timestampMs: t0 + 300_000 };
  const b = await blockBefore(chain, Date.parse('2026-01-01T00:00:00Z'), head, 100);
  assert.equal(b.height, 349, 'block 350 is exactly midnight, so 349 is the last block before it');
  assert.ok(reads < 40, `binary search, not a scan (${reads} reads)`);
  assert.equal((await blockBefore(chain, head.timestampMs + 1, head, 100)).height, 400, 'a start after the head is the head');
});
