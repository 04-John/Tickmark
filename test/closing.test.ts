import assert from 'node:assert/strict';
import { test } from 'node:test';
import { closingProposal, findClosings, mayPropose, nearCliCommand } from '../core/closing.ts';
import type { DaoPolicy } from '../core/dao.ts';
import type { Proposal } from '../core/types.ts';
import * as fx from './fixtures/proposals.ts';

const report = {
  dao: fx.DAO,
  since: '2025-11-13',
  asOf: { block: 224_093_781, time: '2026-11-11T17:08:20.327Z' },
  fingerprint: 'cf6a0a675c2427baca5995335cd63ff7cf9133ace0766f47710d1eb737c5a641',
  totals: { lines: 20, spendingCents: 461_200, suspenseCents: 707_100, unpricedLines: 0, questions: 5 },
  tickmark: '0.1.0',
};

const policy: DaoPolicy = {
  roles: [
    { name: 'council', kind: { Group: ['alice.near', 'bob.near'] }, permissions: ['*:AddProposal', '*:VoteApprove'], vote_policy: {} },
    { name: 'all', kind: 'Everyone', permissions: ['transfer:AddProposal'], vote_policy: {} },
  ],
  default_vote_policy: {},
  proposal_bond: '100000000000000000000000',
  proposal_period: '604800000000000',
};

test('the closing proposal is a text-only Vote carrying the fingerprint, with the DAO bond as deposit', () => {
  const call = closingProposal(report, policy);
  assert.deepEqual([call.contract, call.method, call.args.proposal.kind, call.deposit], [fx.DAO, 'add_proposal', 'Vote', '100000000000000000000000']);
  const d = call.args.proposal.description;
  assert.match(d, /^\* Title: Close the books, 2025-11-13 to 2026-11-11 <br>/);
  assert.match(d, /\* Tickmark Report: sha256:cf6a0a67[0-9a-f]{56} <br>\* As Of Block: 224093781/);
  assert.match(d, /\$4,612 of spending, \$7,071 not yet explained, 5 questions/);
  assert.match(d, /This proposal moves no money/);
  const cmd = nearCliCommand(call, 'alice.near', 'mainnet');
  assert.match(cmd, /^near contract call-function as-transaction acme\.sputnik-dao\.near add_proposal/);
  assert.match(cmd, /attached-deposit '100000000000000000000000 yoctoNEAR'/);
  assert.match(cmd, /sign-as alice\.near network-config mainnet sign-with-keychain send$/);
});

test('who may propose: council members by group, not everyone when Everyone may only propose transfers', () => {
  assert.deepEqual(mayPropose(policy, 'alice.near'), { allowed: true, roles: ['council'] });
  assert.deepEqual(mayPropose(policy, 'mallory.near'), { allowed: false, roles: [] });
});

test('closings are found by their fingerprint field, newest first, with their vote', () => {
  const description = closingProposal(report, policy).args.proposal.description;
  const base = { ...fx.vote, kind: 'Vote', votes: {} } as Proposal;
  const proposals: Proposal[] = [
    { ...base, id: 30, description, status: 'Approved', votes: { 'alice.near': 'Approve', 'bob.near': 'Approve' } },
    { ...base, id: 31, description: '* Title: lunch poll', status: 'Approved' },
    { ...base, id: 32, description: description.replace(/sha256:[0-9a-f]{64}/, 'sha256:nothex'), status: 'InProgress' },
    { ...base, id: 33, description, status: 'InProgress' },
    { ...fx.nativeTransfer, id: 34, description }, // not a Vote: a payment can't close the books
  ];
  const found = findClosings(proposals);
  assert.deepEqual(found.map((c) => [c.proposalId, c.status, c.asOfBlock]), [
    [33, 'InProgress', 224093781],
    [30, 'Approved', 224093781],
  ]);
  assert.equal(found[1]!.fingerprint, report.fingerprint);
  assert.deepEqual(found[1]!.votes, { 'alice.near': 'Approve', 'bob.near': 'Approve' });
  assert.equal(found[1]!.title, 'Close the books, 2025-11-13 to 2026-11-11');
});
