import assert from 'node:assert/strict';
import { test } from 'node:test';
import { journal, statement } from '../core/books.ts';
import { classify } from '../core/classify.ts';
import { decodeProposal } from '../core/decode.ts';
import { auditQuestions } from '../core/questions.ts';
import { buildReport, canonicalJson, fingerprintOf, firstDifference, sha256Hex, signReport } from '../core/report.ts';
import type { ValuedMovement } from '../core/value.ts';
import * as fx from './fixtures/proposals.ts';

test('canonical JSON sorts keys at every level, drops undefined, and refuses non-finite numbers', () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: 'x' }, u: undefined }), '{"a":{"c":"x","d":[3,{"y":2,"z":1}]},"b":1}');
  assert.equal(canonicalJson({ a: 1, b: 2 }), canonicalJson({ b: 2, a: 1 }));
  assert.throws(() => canonicalJson({ x: Number.NaN }), /cannot fingerprint/);
});

test('sha256 matches the standard test vector', async () => {
  assert.equal(await sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

function sampleReport() {
  const [m] = decodeProposal(fx.DAO, fx.nativeTransfer);
  const valued: ValuedMovement = { ...m!, paidAt: Date.parse('2026-03-03T10:00:00Z'), dateSource: 'approval_vote', symbol: 'NEAR', decimals: 24, quantity: '133', unitPrice: 3, usd: 399, priceDate: '2026-03-03' };
  const classified = classify([valued]);
  const entries = journal(classified);
  return buildReport({
    tickmark: '0.1.0',
    dao: fx.DAO,
    network: 'mainnet',
    since: '2026-01-01',
    asOf: { block: 200_000_000, time: '2026-11-11T00:00:00.000Z' },
    opening: { block: 150_000_000, time: '2025-12-31T23:59:59.400Z' },
    pricesThrough: { near: '2026-11-10' },
    statement: statement(entries),
    balances: [],
    questions: auditQuestions(classified, [fx.nativeTransfer], { nowMs: Date.parse('2026-11-11') }),
    journal: entries,
  });
}

test('the fingerprint covers the whole report, not the fingerprint itself, and any edit changes it', async () => {
  const signed = await signReport(sampleReport());
  assert.match(signed.fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(await fingerprintOf(signed), signed.fingerprint, 'recomputing from the signed report gives the same value');
  assert.equal((await signReport(sampleReport())).fingerprint, signed.fingerprint, 'the same input gives the same fingerprint');
  assert.deepEqual([signed.totals.lines, signed.totals.spendingCents], [1, 39900]);

  const edited = structuredClone(signed);
  edited.journal[0]!.payee = 'someone-else.near';
  assert.notEqual(await fingerprintOf(edited), signed.fingerprint);
  assert.deepEqual(firstDifference(signed, edited), { path: 'journal[0].payee', a: 'designer.near', b: 'someone-else.near' });
  assert.deepEqual(firstDifference({ a: 1 }, { a: 1, extra: true }), { path: 'extra', a: undefined, b: true });
  assert.equal(firstDifference(signed, structuredClone(signed)), null);
});
