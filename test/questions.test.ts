import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classify } from '../core/classify.ts';
import { decodeProposal } from '../core/decode.ts';
import { auditQuestions, invoiceNumbers, isUnnamed, saysNothing, statedAmounts, type QuestionKind } from '../core/questions.ts';
import { KNOWN_TOKENS } from '../core/tokens.ts';
import type { Proposal, ProposalStatus } from '../core/types.ts';
import { formatUnits } from '../core/units.ts';
import type { ValuedMovement } from '../core/value.ts';
import * as fx from './fixtures/proposals.ts';

const USDC = '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64');
const at = (isoDay: string) => Date.parse(`${isoDay}T12:00:00Z`);

type P = { id: number; day: string; to: string; amount: string; token?: string; memo?: string; status?: ProposalStatus; votes?: Record<string, string> };

/** A Transfer proposal and its valued, dated movement (NEAR at $2, stablecoins at $1). */
function make(p: P): { proposal: Proposal; movement: ValuedMovement } {
  const token = p.token ?? 'near';
  const proposal: Proposal = {
    ...fx.nativeTransfer,
    id: p.id,
    description: p.memo ?? '',
    status: p.status ?? 'Approved',
    votes: p.votes ?? {},
    submission_time: (BigInt(at(p.day)) * 1_000_000n).toString(),
    kind: { Transfer: { token_id: token === 'near' ? '' : token, receiver_id: p.to, amount: p.amount, msg: null } },
  };
  const [m] = decodeProposal(fx.DAO, proposal);
  const info = KNOWN_TOKENS[token]!;
  const quantity = formatUnits(p.amount, info.decimals);
  const unitPrice = info.price === 'usd' ? 1 : 2;
  const movement: ValuedMovement = { ...m!, paidAt: m!.executed ? at(p.day) : undefined, symbol: info.symbol, decimals: info.decimals, quantity, unitPrice, usd: Number(quantity) * unitPrice, priceDate: p.day };
  return { proposal, movement };
}

function ask(ps: P[], options = {}) {
  const made = ps.map(make);
  return auditQuestions(classify(made.map((x) => x.movement)), made.map((x) => x.proposal), { nowMs: at('2026-06-01'), ...options });
}
const kinds = (qs: { kind: QuestionKind }[]) => qs.map((q) => q.kind);
const usdc = (n: number) => String(Math.round(n * 1e6));
const near = (n: number) => (BigInt(n) * 10n ** 24n).toString();

test('stated amounts: dollars, token amounts either way round, thousands and k/m', () => {
  assert.deepEqual(statedAmounts('Invoice #12, US$750'), [{ unit: 'USD', value: 750 }]);
  assert.deepEqual(statedAmounts('Send protocol fee USDC 3127.429191 to pf.rhealab.near'), [{ unit: 'USDC', value: 3127.429191 }]);
  assert.deepEqual(statedAmounts('pay 1,000 NEAR and $2.5k'), [{ unit: 'USD', value: 2500 }, { unit: 'NEAR', value: 1000 }]);
  assert.deepEqual(statedAmounts('Invoice #12 for March 2026'), [], 'numbers without a unit are not amounts');
});

test('a same-amount payment to the same payee within two weeks is asked about; a month apart is not', () => {
  const qs = ask([
    { id: 1, day: '2026-03-01', to: 'designer.near', amount: usdc(900), token: USDC, memo: 'Invoice 7' },
    { id: 2, day: '2026-03-04', to: 'designer.near', amount: usdc(900), token: USDC, memo: 'Invoice 7' },
    { id: 3, day: '2026-04-20', to: 'designer.near', amount: usdc(900), token: USDC, memo: 'Invoice 9' },
  ]);
  const dup = qs.filter((q) => q.kind === 'possible_duplicate');
  assert.equal(dup.length, 1);
  assert.equal(dup[0]!.ask, 'Was invoice 7 paid twice? #1 and #2 each sent 900 USDC to designer.near, 3 days apart.');
  assert.deepEqual(dup[0]!.proposals, [1, 2]);
});

test('repeats are one question per cluster, small repeats are ignored, and one bulk list is never a repeat', () => {
  const qs = ask([
    { id: 1, day: '2026-03-01', to: 'transit.near', amount: near(45_000), memo: 'ops' },
    { id: 2, day: '2026-03-02', to: 'transit.near', amount: near(45_000), memo: 'ops' },
    { id: 3, day: '2026-03-05', to: 'transit.near', amount: near(45_000), memo: 'ops' },
    { id: 4, day: '2026-03-01', to: 'tester.near', amount: near(1), memo: 'test' },
    { id: 5, day: '2026-03-03', to: 'tester.near', amount: near(1), memo: 'test' },
  ]);
  const dup = qs.filter((q) => q.kind === 'possible_duplicate');
  assert.equal(dup.length, 1, '1 NEAR ($2) twice is below the $100 floor');
  assert.equal(dup[0]!.ask, 'Was transit.near meant to be paid 3 times? #1, #2 and #3 each sent 45,000 NEAR, within 4 days.');
  assert.equal(dup[0]!.cents, 2 * 90_000_00, 'at stake: the repeats, not the first payment');
});

test('the same invoice number paid twice is asked about at any amount', () => {
  const qs = ask([
    { id: 1, day: '2026-03-01', to: 'studio.near', amount: near(1), memo: 'Website design, invoice 41' },
    { id: 2, day: '2026-03-01', to: 'studio.near', amount: near(1), memo: 'Website design, Invoice #41' },
    { id: 3, day: '2026-03-02', to: 'cafe.near', amount: near(1), memo: 'Invoice 7' },
    { id: 4, day: '2026-03-02', to: 'cafe.near', amount: near(1), memo: 'Invoice 8' },
  ]).filter((q) => q.kind === 'possible_duplicate');
  assert.deepEqual(qs.map((q) => q.ask), ['Was invoice 41 paid twice? #1 and #2 each sent 1 NEAR to studio.near, on the same day.']);
  assert.deepEqual(invoiceNumbers('INV-0042 and inv 47; invoice no. 9'), ['42', '47', '9']);
});

test('payee votes are one question per payee', () => {
  const votes = { 'alice.near': 'Approve', 'bob.near': 'Approve' };
  const qs = ask([
    { id: 1, day: '2026-03-01', to: 'alice.near', amount: near(50), memo: 'Invoice 1', votes },
    { id: 2, day: '2026-04-01', to: 'alice.near', amount: near(60), memo: 'Invoice 2', votes },
  ]).filter((q) => q.kind === 'payee_voted');
  assert.equal(qs.length, 1);
  assert.equal(qs[0]!.ask, 'alice.near voted to approve 2 proposals that paid them $220 (#1 and #2). Did someone other than the payee review them?');
});

test('an unpaid swap is not a debt', () => {
  const swapTo = 'ef'.repeat(32);
  const proposal: Proposal = {
    ...fx.nativeTransfer,
    id: 7,
    status: 'Expired',
    description: `* Proposal Action: asset-exchange <br>* Deposit Address: ${swapTo}`,
    kind: { Transfer: { token_id: USDC, receiver_id: swapTo, amount: usdc(15_120), msg: null } },
  };
  const [m] = decodeProposal(fx.DAO, proposal);
  const valued: ValuedMovement = { ...m!, symbol: 'USDC', decimals: 6, quantity: '15120', unitPrice: 1, usd: 15_120, priceDate: '2026-03-02' };
  assert.deepEqual(auditQuestions(classify([valued]), [proposal]), []);
});

test('a description amount that differs from what was sent, in the same unit only', () => {
  const qs = ask([
    { id: 1, day: '2026-03-01', to: 'a.near', amount: usdc(700), token: USDC, memo: 'Invoice 12, US$750' },
    { id: 2, day: '2026-03-01', to: 'b.near', amount: usdc(700), token: USDC, memo: 'Invoice 13, $700' },
    { id: 3, day: '2026-03-01', to: 'c.near', amount: near(100), memo: 'Invoice 14, $750' },
    { id: 4, day: '2026-03-01', to: 'd.near', amount: near(900), memo: 'grant: 1,000 NEAR' },
    { id: 5, day: '2026-03-01', to: 'e.near', amount: usdc(5000), token: USDC, memo: 'grant 5k USDC' },
  ]);
  const mismatch = qs.filter((q) => q.kind === 'memo_amount_mismatch');
  assert.deepEqual(mismatch.map((q) => q.proposals[0]), [4, 1], '#3 is NEAR against dollars: prices move, so it is not compared; largest first');
  assert.equal(mismatch.find((q) => q.proposals[0] === 1)!.ask, '#1 says 750 USD, but sent 700 USDC. Which is right?');
});

test('a bulk list whose lines do not add up to the total its proposal states', () => {
  const proposal: Proposal = {
    ...fx.nativeTransfer,
    id: 9,
    description: '* Proposal Action: bulk-payment <br>* Notes: March retainers <br>* Recipients: 3 <br>* Amount: 2700 <br>* List Id: abc',
    kind: { FunctionCall: { receiver_id: USDC, actions: [{ method_name: 'ft_transfer_call', args: b64({ receiver_id: 'bulkpayment.near', amount: usdc(2700), msg: 'abc' }), deposit: '1', gas: '0' }] } },
  };
  const [placeholder] = decodeProposal(fx.DAO, proposal);
  const line = (to: string, n: number, i: number): ValuedMovement => ({
    ...placeholder!,
    line: i,
    to,
    amount: usdc(n),
    bulkListId: undefined,
    symbol: 'USDC',
    decimals: 6,
    quantity: String(n),
    unitPrice: 1,
    usd: n,
    priceDate: '2026-03-02',
  });
  const run = (amounts: number[]) =>
    auditQuestions(classify(amounts.map((n, i) => line(`p${i}.near`, n, i))), [proposal]).filter((q) => q.kind === 'memo_amount_mismatch');
  assert.equal(run([900, 900, 900]).length, 0);
  assert.equal(run([900, 900, 800])[0]?.ask, '#9 says 2,700 USDC, but sent 2,600 USDC. Which is right?');
});

test('a failed or stale request with no later payment: is the payee still owed?', () => {
  const qs = ask(
    [
      { id: 1, day: '2026-03-01', to: 'a.near', amount: near(5), memo: 'Invoice 1', status: 'Failed' },
      { id: 2, day: '2026-03-01', to: 'b.near', amount: near(5), memo: 'Invoice 2', status: 'Failed' },
      { id: 3, day: '2026-03-03', to: 'b.near', amount: near(5), memo: 'Invoice 2, again' },
      { id: 4, day: '2026-04-01', to: 'c.near', amount: near(5), memo: 'Invoice 3', status: 'InProgress' },
      { id: 5, day: '2026-05-30', to: 'd.near', amount: near(5), memo: 'Invoice 4', status: 'InProgress' },
      { id: 6, day: '2026-03-01', to: 'e.near', amount: near(5), memo: 'Invoice 5', status: 'Rejected' },
    ],
    { proposalPeriodMs: 7 * 86_400_000 },
  );
  const owed = qs.filter((q) => q.kind === 'possibly_still_owed');
  assert.deepEqual(owed.map((q) => q.proposals[0]), [1, 4], '#2 was paid by #3, #5 is still in its voting period, #6 was a decision');
  assert.equal(owed[0]!.ask, 'Is a.near still owed 5 NEAR? #1 failed on chain, and no later payment matches.');
});

test('the payee voted to approve their own payment', () => {
  const qs = ask([{ id: 1, day: '2026-03-01', to: 'alice.near', amount: near(50), memo: 'Invoice 1', votes: { 'alice.near': 'Approve', 'bob.near': 'Approve' } }]);
  const q = qs.find((x) => x.kind === 'payee_voted')!;
  assert.equal(q.ask, 'alice.near voted to approve #1, which paid them 50 NEAR. Did someone other than the payee review it?');
});

test('large payments without a description, unnamed payees, and unexplained payments by payee', () => {
  const hex = 'ab'.repeat(32);
  const qs = ask([
    { id: 1, day: '2026-03-01', to: 'vendor.near', amount: usdc(20_000), token: USDC, memo: 'Invoice 1' },
    { id: 2, day: '2026-04-01', to: 'vendor.near', amount: usdc(30_000), token: USDC, memo: '' }, // placed by payee history
    { id: 3, day: '2026-04-02', to: 'vendor.near', amount: usdc(500), token: USDC, memo: 'Payment Request' }, // small
    { id: 4, day: '2026-04-03', to: hex, amount: near(1000), memo: '' },
    { id: 5, day: '2026-04-09', to: hex, amount: near(2000), memo: 'transfer' },
  ]);
  assert.deepEqual(kinds(qs), ['large_without_description', 'unnamed_payee', 'unexplained']);
  assert.equal(qs[0]!.ask, 'Which invoice or agreement does #2 pay? $30,000 to vendor.near on 2026-04-01, and the proposal does not say.');
  assert.match(qs[0]!.facts[0]!, /#1 paid vendor\.near as Contractors and services/);
  assert.equal(qs[1]!.ask, 'Who is abababab…abab? It received $6,000 in 2 payments, and an account without a name can’t be matched to a vendor or invoice.');
  assert.equal(qs[2]!.ask, 'What were the payments to abababab…abab for? $6,000 in 2 payments.');
});

test('swaps and moves within the treasury raise no questions', () => {
  const swapTo = 'cd'.repeat(32);
  const proposal: Proposal = {
    ...fx.nativeTransfer,
    id: 1,
    description: `* Proposal Action: asset-exchange <br>* Deposit Address: ${swapTo}`,
    kind: { Transfer: { token_id: USDC, receiver_id: swapTo, amount: usdc(50_000), msg: null } },
  };
  const [m] = decodeProposal(fx.DAO, proposal);
  const valued: ValuedMovement = { ...m!, symbol: 'USDC', decimals: 6, quantity: '50000', unitPrice: 1, usd: 50_000, priceDate: '2026-03-02' };
  assert.deepEqual(auditQuestions(classify([valued, { ...valued, line: 1 }]), [proposal]), []);
});

test('helpers', () => {
  assert.ok(isUnnamed('ab'.repeat(32)));
  assert.ok(isUnnamed('0x' + 'a'.repeat(40)));
  assert.ok(!isUnnamed('alice.near'));
  assert.ok(saysNothing('') && saysNothing('Transfer') && saysNothing('Payment Request') && saysNothing(' - '));
  assert.ok(!saysNothing('cNear') && !saysNothing('inv 47'));
});
