import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeProposal, kindName, normalizeToken } from '../core/decode.ts';
import * as fx from './fixtures/proposals.ts';

const one = (p: Parameters<typeof decodeProposal>[1]) => {
  const out = decodeProposal(fx.DAO, p);
  assert.equal(out.length, 1, `expected one movement for proposal ${p.id}`);
  return out[0]!;
};

test('native NEAR Transfer proposal', () => {
  const m = one(fx.nativeTransfer);
  assert.deepEqual([m.token, m.to, m.amount, m.via, m.executed], ['near', 'designer.near', '133000000000000000000000000', 'transfer', true]);
  assert.equal(m.proposedAt, Date.parse('2026-03-02T12:00:00Z'));
  assert.match(m.memo, /Invoice #12/);
});

test('token Transfer proposal keeps the token contract', () => {
  const m = one(fx.usdcTransfer);
  assert.equal(m.token, '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1');
  assert.equal(m.amount, '750000000');
});

test('ft_transfer function call pays the receiver in args, in the called token', () => {
  const m = one(fx.ftTransfer);
  assert.deepEqual([m.token, m.to, m.amount, m.via], ['usdt.tether-token.near', 'dev.near', '1200000000', 'ft_transfer']);
});

test('NEAR Intents mt_transfer strips the nep141: prefix', () => {
  const m = one(fx.intentsTransfer);
  assert.deepEqual([m.token, m.to, m.via], ['17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1', 'contractor.near', 'intents_transfer']);
});

test('NEAR Intents mt_batch_transfer gives one movement per token', () => {
  const out = decodeProposal(fx.DAO, fx.batchIntents);
  assert.deepEqual(
    out.map((m) => [m.token, m.amount, m.line]),
    [
      ['usdt.tether-token.near', '1000000', 0],
      ['wrap.near', '2000000000000000000000000', 1],
    ],
  );
});

test('NEAR Intents ft_withdraw', () => {
  const m = one(fx.intentsWithdraw);
  assert.deepEqual([m.token, m.to, m.via], ['eth.omft.near', 'eth.bridge.near', 'intents_withdraw']);
});

test('Trezu bulk payment becomes a placeholder carrying the list id and total', () => {
  const m = one(fx.bulkPayment);
  assert.deepEqual([m.via, m.bulkListId, m.amount, m.to], ['bulk_payment', 'list-abc', '30000000000000000000000000', 'bulkpayment.near']);
});

test('NEAR attached to another call is an attached_deposit', () => {
  const m = one(fx.staking);
  assert.deepEqual([m.via, m.method, m.to, m.token], ['attached_deposit', 'deposit_and_stake', 'validator.poolv1.near', 'near']);
});

test('a deposit into NEAR Intents with an empty message stays with the treasury', () => {
  const m = one(fx.swapDeposit);
  assert.deepEqual([m.via, m.to, m.token], ['intents_deposit', fx.DAO, 'usdt.tether-token.near']);
});

test('a deposit into NEAR Intents for another account pays that account', () => {
  const deposit = (msg: string) =>
    one({
      ...fx.swapDeposit,
      kind: {
        FunctionCall: {
          receiver_id: 'wrap.near',
          actions: [{ method_name: 'ft_transfer_call', args: Buffer.from(JSON.stringify({ receiver_id: 'intents.near', amount: '7', msg })).toString('base64'), deposit: '1', gas: '0' }],
        },
      },
    });
  assert.deepEqual([deposit('artist.near').to, deposit('artist.near').via], ['artist.near', 'intents_deposit']);
  assert.equal(deposit('{"receiver_id":"studio.near"}').to, 'studio.near');
  assert.equal(deposit(fx.DAO).to, fx.DAO);
  assert.equal(deposit('not an account!').to, fx.DAO, 'an unreadable message is credited to the sender, as Intents does');
});

test('ft_transfer_call into another protocol is recorded with its target, and the 1 yocto security deposit is ignored', () => {
  const m = one({
    ...fx.swapDeposit,
    kind: {
      FunctionCall: {
        receiver_id: 'usdt.tether-token.near',
        actions: [{ method_name: 'ft_transfer_call', args: Buffer.from(JSON.stringify({ receiver_id: 'v2.ref-finance.near', amount: '5', msg: '' })).toString('base64'), deposit: '1', gas: '0' }],
      },
    },
  });
  assert.deepEqual([m.via, m.to], ['ft_transfer_call', 'v2.ref-finance.near']);
});

test('governance proposals move no money', () => {
  assert.deepEqual(decodeProposal(fx.DAO, fx.changePolicy), []);
  assert.deepEqual(decodeProposal(fx.DAO, fx.vote), []);
});

test('a Failed proposal is decoded but not executed', () => {
  const m = one(fx.failedTransfer);
  assert.equal(m.status, 'Failed');
  assert.equal(m.executed, false);
});

test('helpers', () => {
  assert.equal(normalizeToken(''), 'near');
  assert.equal(normalizeToken('nep141:wrap.near'), 'wrap.near');
  assert.equal(kindName('Vote'), 'Vote');
  assert.equal(kindName(fx.changePolicy.kind), 'ChangePolicy');
});

test('unparseable args never throw', () => {
  const broken = { ...fx.ftTransfer, kind: { FunctionCall: { receiver_id: 'x.near', actions: [{ method_name: 'ft_transfer', args: '%%%', deposit: '0', gas: '0' }] } } };
  assert.deepEqual(decodeProposal(fx.DAO, broken), []);
});
