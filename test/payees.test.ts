import assert from 'node:assert/strict';
import { test } from 'node:test';
import { journal } from '../core/books.ts';
import { classify } from '../core/classify.ts';
import type { DaoPolicy } from '../core/dao.ts';
import { decodeProposal } from '../core/decode.ts';
import { payeeKind, payeeList, rolesOf } from '../core/payees.ts';
import { auditQuestions } from '../core/questions.ts';
import type { Proposal } from '../core/types.ts';
import type { ValuedMovement } from '../core/value.ts';
import * as fx from './fixtures/proposals.ts';

const near = (n: number) => (BigInt(n) * 10n ** 24n).toString();
const policy: DaoPolicy = {
  roles: [{ name: 'council', kind: { Group: ['alice.near', 'bob.near'] }, permissions: ['*:*'], vote_policy: {} }],
  default_vote_policy: {},
  proposal_bond: '0',
  proposal_period: '0',
};

function make(id: number, day: string, to: string, n: number, description: string, votes: Record<string, string> = {}) {
  const proposal: Proposal = { ...fx.nativeTransfer, id, description, votes, kind: { Transfer: { token_id: '', receiver_id: to, amount: near(n), msg: null } } };
  const [m] = decodeProposal(fx.DAO, proposal);
  const movement: ValuedMovement = { ...m!, paidAt: Date.parse(`${day}T10:00:00Z`), dateSource: 'approval_vote', symbol: 'NEAR', decimals: 24, quantity: String(n), unitPrice: 2, usd: n * 2, priceDate: day };
  return { proposal, movement };
}

test('payees: kinds, council roles, totals, placements, own-payment votes and questions', () => {
  const made = [
    make(1, '2026-03-01', 'alice.near', 100, 'Honorarium', { 'alice.near': 'Approve', 'bob.near': 'Approve' }),
    make(2, '2026-04-01', 'alice.near', 50, 'Travel expenses', { 'bob.near': 'Approve' }),
    make(3, '2026-03-15', 'ab'.repeat(32), 10, ''),
    make(4, '2026-03-20', 'guild.sputnik-dao.near', 5, ''),
    make(5, '2026-03-21', fx.DAO, 7, ''), // to itself: not a payee
  ];
  const classified = classify(made.map((x) => x.movement));
  const proposals = made.map((x) => x.proposal);
  const entries = journal(classified);
  const payees = payeeList(fx.DAO, entries, proposals, policy, auditQuestions(classified, proposals));
  assert.deepEqual(
    payees.map((p) => [p.account, p.kind, p.roles, p.cents, p.lines, p.first, p.last, p.votedOnOwn]),
    [
      ['alice.near', 'named', ['council'], 30000, 2, '2026-03-01', '2026-04-01', [1]],
      ['ab'.repeat(32), 'unnamed', [], 2000, 1, '2026-03-15', '2026-03-15', []],
      ['guild.sputnik-dao.near', 'dao', [], 1000, 1, '2026-03-20', '2026-03-20', []],
    ],
  );
  assert.deepEqual(payees[0]!.categories, [
    { category: 'payroll', lines: 1 },
    { category: 'travel', lines: 1 },
  ]);
  assert.ok(payees[0]!.questions >= 1, 'the payee-voted question counts for alice');
  assert.ok(payees[1]!.questions >= 2, 'unnamed and unexplained');
});

test('payee kinds and roles', () => {
  assert.equal(payeeKind('acme.sputnik-dao.near', 'acme.near'), 'own_name');
  assert.equal(payeeKind('acme.sputnik-dao.near', '0x' + 'a'.repeat(40)), 'unnamed');
  assert.equal(payeeKind('acme.sputnik-dao.near', 'ops.sputnik-dao.near'), 'dao');
  assert.deepEqual(rolesOf(policy, 'bob.near'), ['council']);
  assert.deepEqual(rolesOf(null, 'bob.near'), []);
});
