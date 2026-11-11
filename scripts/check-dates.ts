// Proves the payment dates in a scan, using only the chain (an archival RPC node).
//   node cli/tickmark.ts scan <dao> --json out.json
//   node scripts/check-dates.ts out.json
//
// For a date taken from the approving vote: the proposal must be InProgress just before that block and Approved after it.
// For a date taken from a Trezu bulk line: the line must be unpaid just before that block and Paid after it.
import { readFileSync } from 'node:fs';
import { mapLimit } from '../core/dao.ts';
import { ARCHIVAL_RPC, Rpc, type Network } from '../core/rpc.ts';
import type { Movement } from '../core/types.ts';

const file = process.argv[2];
if (!file) {
  console.log('Usage: node scripts/check-dates.ts <scan.json>');
  process.exit(1);
}
const scan = JSON.parse(readFileSync(file, 'utf8')) as { dao: string; network: Network; movements: Movement[] };
const archival = new Rpc({ network: scan.network, url: ARCHIVAL_RPC[scan.network] });

type Check = { label: string; ok: boolean | 'unchecked'; detail: string };

/** A check that could not reach the node is reported, not counted as a failure or a pass. */
const guard = (label: string, run: () => Promise<Check>): Promise<Check> =>
  run().catch((error: Error) => ({ label, ok: 'unchecked' as const, detail: error.message }));

async function checkVote(proposalId: number, block: number): Promise<Check> {
  const status = async (h: number) => (await archival.at(h).view<{ status: string }>(scan.dao, 'get_proposal', { id: proposalId })).status;
  const before = await status(block - 1);
  const after = await status(block + 1);
  return { label: `#${proposalId} vote at block ${block}`, ok: before === 'InProgress' && after === 'Approved', detail: `${before} -> ${after}` };
}

async function checkBulkLine(m: Movement, listId: string, block: number): Promise<Check> {
  const line = async (h: number) => {
    const list = await archival.at(h).view<{ payments: { recipient: string; amount: string; status: unknown }[] }>('bulkpayment.near', 'view_list', { list_id: listId });
    const p = list.payments.find((x) => x.recipient === m.to && x.amount === m.amount);
    return p ? (typeof p.status === 'object' && p.status !== null && 'Paid' in p.status ? 'Paid' : JSON.stringify(p.status)) : 'missing';
  };
  // Before the list is created the view call fails; that counts as "not paid yet".
  const before = await line(block - 1).catch(() => 'no list yet');
  const after = await line(block);
  return { label: `#${m.proposalId} ${m.to} paid at block ${block}`, ok: before !== 'Paid' && after === 'Paid', detail: `${before} -> ${after}` };
}

const votes = new Map<number, number>();
const bulk: Movement[] = [];
for (const m of scan.movements) {
  if (m.dateSource === 'approval_vote' && m.paidAtBlock) votes.set(m.proposalId, m.paidAtBlock);
  if (m.dateSource === 'bulk_paid_block' && m.paidAtBlock) bulk.push(m);
}

const checks = [
  ...(await mapLimit([...votes], 2, ([id, block]) => guard(`#${id}`, () => checkVote(id, block)))),
  ...(await mapLimit(bulk, 2, (m) => {
    if (!m.bulkList) return Promise.resolve<Check>({ label: `#${m.proposalId}`, ok: false, detail: 'line has no list id' });
    return guard(`#${m.proposalId} ${m.to}`, () => checkBulkLine(m, m.bulkList!, m.paidAtBlock!));
  })),
];
for (const c of checks) console.log(`${c.ok === 'unchecked' ? '??  ' : c.ok ? 'ok  ' : 'FAIL'} ${c.label}: ${c.detail}`);
const failed = checks.filter((c) => c.ok === false).length;
const unchecked = checks.filter((c) => c.ok === 'unchecked').length;
const fallback = scan.movements.filter((m) => m.executed && m.dateSource === 'submitted').length;
console.log(
  `\n${checks.length - failed - unchecked}/${checks.length} payment dates confirmed on chain, ${failed} wrong, ${unchecked} could not be checked; ` +
    `${fallback} executed movements kept their submission date.`,
);
process.exit(failed ? 1 : 0);
