import assert from 'node:assert/strict';
import { test } from 'node:test';
import { expandBulkPayments, fetchProposals, mapLimit, type BulkList } from '../core/dao.ts';
import { decodeProposal } from '../core/decode.ts';
import type { ViewClient } from '../core/rpc.ts';
import type { Proposal } from '../core/types.ts';
import * as fx from './fixtures/proposals.ts';

/** A fake chain: answers view calls from a handler and records them. */
function fakeRpc(handler: (account: string, method: string, args: any) => unknown): ViewClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async view<T>(account: string, method: string, args: unknown = {}) {
      calls.push(`${account}.${method}`);
      const out = handler(account, method, args);
      if (out instanceof Error) throw out;
      return out as T;
    },
  };
}

const at = (iso: string) => (BigInt(Date.parse(iso)) * 1_000_000n).toString();

test('fetchProposals pages backwards and stops at the first proposal older than the cutoff', async () => {
  // 250 proposals, one per day from 2026-01-01.
  const all: Proposal[] = Array.from({ length: 250 }, (_, id) => ({
    ...fx.vote,
    id,
    submission_time: at(new Date(Date.UTC(2026, 0, 1) + id * 86_400_000).toISOString()),
  }));
  const rpc = fakeRpc((_a, method, args) => {
    if (method === 'get_last_proposal_id') return all.length;
    if (method === 'get_proposals') return all.slice(args.from_index, args.from_index + args.limit);
    return new Error('unexpected');
  });
  // Cutoff at id 120: page 150-249 is all in range, page 50-149 is partly in range, page 0-49 is never read.
  const since = Date.UTC(2026, 0, 1) + 120 * 86_400_000;
  const got = await fetchProposals(rpc, fx.DAO, since);
  assert.deepEqual(
    got.map((p) => p.id),
    Array.from({ length: 130 }, (_, i) => 120 + i),
  );
  assert.equal(rpc.calls.filter((c) => c.endsWith('get_proposals')).length, 2, 'only the pages in range are read');
});

test('fetchProposals with no cutoff reads everything, oldest first', async () => {
  const all: Proposal[] = Array.from({ length: 130 }, (_, id) => ({ ...fx.vote, id }));
  const rpc = fakeRpc((_a, method, args) => (method === 'get_last_proposal_id' ? all.length : all.slice(args.from_index, args.from_index + args.limit)));
  const got = await fetchProposals(rpc, fx.DAO);
  assert.equal(got.length, 130);
  assert.equal(got[0]!.id, 0);
});

test('bulk lists expand to one paid line per recipient', async () => {
  const list: BulkList = {
    token_id: 'native',
    submitter: fx.DAO,
    status: 'Approved',
    payments: [
      { recipient: 'alice.near', amount: '10000000000000000000000000', status: { Paid: { block_height: 1 } } },
      { recipient: 'bob.near', amount: '20000000000000000000000000', status: 'Pending' },
    ],
  };
  const rpc = fakeRpc((account, method, args) => (account === 'bulkpayment.near' && method === 'view_list' && args.list_id === 'list-abc' ? list : new Error('no')));
  const out = await expandBulkPayments(rpc, decodeProposal(fx.DAO, fx.bulkPayment));
  assert.deepEqual(
    out.map((m) => [m.to, m.amount, m.token, m.executed, m.via]),
    [
      ['alice.near', '10000000000000000000000000', 'near', true, 'bulk_payment'],
      ['bob.near', '20000000000000000000000000', 'near', false, 'bulk_payment'],
    ],
  );
  assert.equal(new Set(out.map((m) => m.line)).size, 2, 'lines stay unique');
  assert.match(out[1]!.note ?? '', /Pending/);
});

test('a bulk list that cannot be read keeps its total and says why', async () => {
  const rpc = fakeRpc(() => new Error('RPC down'));
  const out = await expandBulkPayments(rpc, decodeProposal(fx.DAO, fx.bulkPayment));
  assert.equal(out.length, 1);
  assert.equal(out[0]!.amount, '30000000000000000000000000');
  assert.match(out[0]!.note ?? '', /could not be read: RPC down/);
});

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64');

test('a token bulk list is funded and released by one ft_transfer_call carrying the list id', async () => {
  // Shape seen on mainnet (Trezu): no approve_list, the list id travels as the ft_transfer_call message.
  const funding: Proposal = {
    ...fx.bulkPayment,
    kind: {
      FunctionCall: {
        receiver_id: 'usdt.tether-token.near',
        actions: [{ method_name: 'ft_transfer_call', args: b64({ receiver_id: 'bulkpayment.near', amount: '3000000', msg: 'usdt-list' }), deposit: '1', gas: '0' }],
      },
    },
  };
  const [placeholder] = decodeProposal(fx.DAO, funding);
  assert.deepEqual([placeholder!.via, placeholder!.bulkListId, placeholder!.token], ['bulk_payment', 'usdt-list', 'usdt.tether-token.near']);

  const list: BulkList = {
    token_id: 'usdt.tether-token.near',
    submitter: fx.DAO,
    status: 'Approved',
    payments: [
      { recipient: 'carol.near', amount: '1000000', status: { Paid: {} } },
      { recipient: 'dan.near', amount: '2000000', status: { Paid: {} } },
    ],
  };
  const out = await expandBulkPayments(fakeRpc(() => list), [placeholder!]);
  assert.deepEqual(
    out.map((m) => [m.to, m.amount, m.token, m.via]),
    [
      ['carol.near', '1000000', 'usdt.tether-token.near', 'bulk_payment'],
      ['dan.near', '2000000', 'usdt.tether-token.near', 'bulk_payment'],
    ],
  );
});

test('a token bulk list funded from the NEAR Intents balance', async () => {
  const funding: Proposal = {
    ...fx.bulkPayment,
    kind: {
      FunctionCall: {
        receiver_id: 'intents.near',
        actions: [
          {
            method_name: 'mt_transfer_call',
            args: b64({ receiver_id: 'bulkpayment.near', token_id: 'nep141:wrap.near', amount: '5', msg: 'intents-list' }),
            deposit: '1',
            gas: '0',
          },
        ],
      },
    },
  };
  const [placeholder] = decodeProposal(fx.DAO, funding);
  assert.deepEqual([placeholder!.via, placeholder!.bulkListId, placeholder!.token], ['bulk_payment', 'intents-list', 'wrap.near']);
  const list: BulkList = { token_id: 'nep141:wrap.near', submitter: fx.DAO, status: 'Approved', payments: [{ recipient: 'erin.near', amount: '5', status: { Paid: {} } }] };
  const [line] = await expandBulkPayments(fakeRpc(() => list), [placeholder!]);
  assert.equal(line!.token, 'wrap.near', 'nep141: prefix stripped from the list token');
});

test('mapLimit keeps order and respects the limit', async () => {
  let running = 0;
  let peak = 0;
  const out = await mapLimit([5, 1, 3, 2, 4], 2, async (n) => {
    running++;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, n));
    running--;
    return n * 10;
  });
  assert.deepEqual(out, [50, 10, 30, 20, 40]);
  assert.ok(peak <= 2);
});
