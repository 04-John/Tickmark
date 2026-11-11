import assert from 'node:assert/strict';
import { test } from 'node:test';
import { journal } from '../core/books.ts';
import { classify } from '../core/classify.ts';
import { decodeProposal } from '../core/decode.ts';
import { buildMessages, parseSuggestions, pickTeeModel, practiceSuggestions, SUGGESTABLE, suspenseGroups } from '../core/suggest.ts';
import type { Proposal } from '../core/types.ts';
import type { ValuedMovement } from '../core/value.ts';
import * as fx from './fixtures/proposals.ts';

const near = (n: number) => (BigInt(n) * 10n ** 24n).toString();
function paid(id: number, to: string, n: number, description: string): ValuedMovement {
  const p: Proposal = { ...fx.nativeTransfer, id, description, kind: { Transfer: { token_id: '', receiver_id: to, amount: near(n), msg: null } } };
  const [m] = decodeProposal(fx.DAO, p);
  return { ...m!, paidAt: Date.parse('2026-04-01T10:00:00Z'), dateSource: 'approval_vote', symbol: 'NEAR', decimals: 24, quantity: String(n), unitPrice: 2, usd: n * 2, priceDate: '2026-04-01' };
}

const entries = journal(classify([paid(1, 'studio.near', 500, 'Invoice 3'), paid(2, 'ab'.repeat(32), 1000, ''), paid(3, 'ab'.repeat(32), 50, 'transfer'), paid(4, 'mystery.near', 10, 'nov/dec')]));
const groups = suspenseGroups(entries);

test('only Suspense lines are sent, grouped by payee, largest first', () => {
  assert.deepEqual(groups.map((g) => [g.payee, g.totalCents, g.lines.length]), [
    ['ab'.repeat(32), 210000, 2],
    ['mystery.near', 2000, 1],
  ]);
  assert.ok(!groups.some((g) => g.payee === 'studio.near'), 'placed lines are never sent');
  assert.equal(suspenseGroups(entries, 1).length, 1);
});

test('the prompt holds the facts, the allowed accounts, and private notes only when given', () => {
  const [system, user] = buildMessages(fx.DAO, groups, 'mystery.near is our accountant, paid monthly');
  assert.match(system!.content, /Reply with JSON only/);
  for (const id of SUGGESTABLE) assert.ok(system!.content.includes(`${id}: `), id);
  assert.ok(!system!.content.includes('suspense:'), 'Suspense is not a suggestion');
  assert.match(user!.content, /mystery\.near is our accountant/);
  assert.match(user!.content, /"description":"nov\/dec"/);
  assert.match(buildMessages(fx.DAO, groups)[1]!.content, /No private notes were given/);
});

test('replies are parsed strictly: unknown payees and accounts outside the chart are dropped and reported', () => {
  const reply = '```json\n' +
    JSON.stringify({
      suggestions: [
        { payee: 'mystery.near', category: 'contractors', confidence: 'medium', reason: 'Monthly payments matching the accountant note.', question: 'Is mystery.near your accountant?' },
        { payee: 'ab'.repeat(32), category: 'yacht_fund', confidence: 'high', reason: 'x', question: 'y' },
        { payee: 'invented.near', category: 'grants', confidence: 'high', reason: 'x', question: 'y' },
      ],
    }) +
    '\n```';
  const { suggestions, problems } = parseSuggestions(reply, groups);
  assert.deepEqual(suggestions.map((s) => [s.payee, s.category, s.categoryName, s.confidence, s.refs]), [['mystery.near', 'contractors', 'Contractors and services', 'medium', ['TM-4-0']]]);
  assert.deepEqual(problems, [`${'ab'.repeat(32)}: category "yacht_fund" is not in the chart`, 'unknown payee in reply: invented.near', `no suggestion for ${'ab'.repeat(32)}`]);
  assert.deepEqual(parseSuggestions('I think it is payroll', groups).problems, ['the reply was not JSON']);
});

test('practice mode says plainly that no model was called', () => {
  const [s] = practiceSuggestions(groups);
  assert.deepEqual([s!.category, s!.confidence], ['unknown', 'low']);
  assert.match(s!.reason, /Practice mode: no AI model was called/);
});

test('only a model NEAR AI lists as verifiable with attestation is used', () => {
  const list = [
    { modelId: 'z-ai/glm-5.3-flash', metadata: { verifiable: true, attestationSupported: true } },
    { modelId: 'openai/gpt-5-nano', metadata: {} },
  ];
  assert.equal(pickTeeModel(list, 'z-ai/glm-5.3-flash'), 'z-ai/glm-5.3-flash');
  assert.throws(() => pickTeeModel(list, 'openai/gpt-5-nano'), /not a verifiable TEE model.*z-ai\/glm-5\.3-flash/);
});
