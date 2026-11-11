import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeProposal } from '../core/decode.ts';
import { PriceBook } from '../core/prices.ts';
import type { ViewClient } from '../core/rpc.ts';
import { TokenBook } from '../core/tokens.ts';
import { formatUnits, nsToMs, parseBase64Json, toBase64, toNumber } from '../core/units.ts';
import { valueMovements } from '../core/value.ts';
import * as fx from './fixtures/proposals.ts';

const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 1000;
const prices = new PriceBook([
  { asset: 'near', coingeckoId: 'near', fetchedAt: '', points: [[day('2026-03-01'), 2], [day('2026-03-02'), 3], [day('2026-03-03'), 4]] },
]);

test('formatUnits is exact', () => {
  assert.equal(formatUnits('133000000000000000000000000', 24), '133');
  assert.equal(formatUnits('1500000', 6), '1.5');
  assert.equal(formatUnits('1', 24), '0.000000000000000000000001');
  assert.equal(formatUnits('0', 6), '0');
  assert.equal(formatUnits('-2500000', 6), '-2.5');
  assert.equal(toNumber('750000000', 6), 750);
  assert.equal(nsToMs('1772452800000000000'), Date.parse('2026-03-02T12:00:00Z'));
});

test('base64 helpers round-trip UTF-8', () => {
  assert.deepEqual(parseBase64Json(toBase64(JSON.stringify({ memo: 'café ☕' }))), { memo: 'café ☕' });
  assert.equal(parseBase64Json('not base64 json'), null);
});

test('price lookup uses the last price at or before the moment, never the next day', () => {
  assert.equal(prices.quote('near', Date.parse('2026-03-02T23:59:00Z'))?.usd, 3);
  assert.equal(prices.quote('near', Date.parse('2026-03-02T00:00:00Z'))?.usd, 3);
  assert.equal(prices.quote('near', Date.parse('2026-03-01T12:00:00Z'))?.date, '2026-03-01');
});

test('no price outside the snapshot, and stablecoins are $1', () => {
  assert.equal(prices.quote('near', Date.parse('2026-02-28T12:00:00Z')), null, 'before the first day');
  assert.equal(prices.quote('near', Date.parse('2026-03-09T12:00:00Z')), null, 'more than two days after the last day');
  assert.equal(prices.quote('eth', Date.parse('2026-03-02T12:00:00Z')), null, 'asset without a series');
  assert.deepEqual(prices.quote('usd', Date.parse('2026-03-02T12:00:00Z')), { usd: 1, date: '2026-03-02' });
  assert.deepEqual(prices.range('near'), { from: '2026-03-01', to: '2026-03-03' });
});

test('valueMovements prices known tokens and leaves unknown ones unpriced', async () => {
  const rpc: ViewClient = {
    async view<T>(account: string, method: string) {
      if (account === 'meme.near' && method === 'ft_metadata') return { symbol: 'USDC', decimals: 6 } as T; // a token calling itself USDC
      throw new Error('not a token');
    },
  };
  const memeTransfer = { ...fx.usdcTransfer, kind: { Transfer: { token_id: 'meme.near', receiver_id: 'x.near', amount: '5000000', msg: null } } };
  const movements = [fx.nativeTransfer, fx.usdcTransfer, memeTransfer].flatMap((p) => decodeProposal(fx.DAO, p));
  const [near, usdc, meme] = await valueMovements(movements, new TokenBook(rpc), prices);
  assert.deepEqual([near!.symbol, near!.quantity, near!.unitPrice, near!.usd, near!.priceDate], ['NEAR', '133', 3, 399, '2026-03-02']);
  assert.deepEqual([usdc!.symbol, usdc!.quantity, usdc!.usd], ['USDC', '750', 750]);
  assert.deepEqual([meme!.symbol, meme!.quantity, meme!.usd], ['USDC', '5', null], 'a symbol alone never earns a price');
});
