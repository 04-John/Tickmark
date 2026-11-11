// Close the books by vote.
//
// The council approves a report with the treasury's own governance: an ordinary Sputnik proposal of kind "Vote"
// (text only, it moves no money) whose description carries the report's fingerprint. No new multisig, no new
// contract. Anyone can then list the closings of a DAO and run `verify` on the report the council approved.
import type { DaoPolicy } from './dao.ts';
import { parseDescription } from './describe.ts';
import type { SignedReport } from './report.ts';
import type { Proposal, ProposalStatus } from './types.ts';
import { nsToMs } from './units.ts';

/** The marker Tickmark looks for in a description: "Tickmark Report: sha256:<64 hex>". */
const REPORT_FIELD = 'tickmark report';
const FINGERPRINT = /^sha256:([0-9a-f]{64})$/;

/** The description of a close-the-books proposal, in the "* Key: value <br>" form Trezu and Sputnik apps show. */
export function closingDescription(report: Pick<SignedReport, 'dao' | 'since' | 'asOf' | 'fingerprint' | 'totals' | 'tickmark'>): string {
  const through = report.asOf.time.slice(0, 10);
  const usd = (cents: number) => `$${Math.round(cents / 100).toLocaleString('en-US')}`;
  return [
    `* Title: Close the books, ${report.since} to ${through}`,
    `* Summary: The council approves the Tickmark report of this treasury's payments from ${report.since} to block ${report.asOf.block} (${through}): ${report.totals.lines} paid lines, ${usd(report.totals.spendingCents)} of spending, ${usd(report.totals.suspenseCents)} not yet explained, ${report.totals.questions} questions for the treasurer. This proposal moves no money.`,
    `* Tickmark Report: sha256:${report.fingerprint}`,
    `* As Of Block: ${report.asOf.block}`,
    `* Verify: node cli/tickmark.ts verify report.json (Tickmark ${report.tickmark})`,
  ].join(' <br>');
}

/** The add_proposal call a council member signs. The deposit is the DAO's proposal bond (returned when it passes). */
export function closingProposal(report: Parameters<typeof closingDescription>[0], policy: Pick<DaoPolicy, 'proposal_bond'>) {
  return {
    contract: report.dao,
    method: 'add_proposal' as const,
    args: { proposal: { description: closingDescription(report), kind: 'Vote' as const } },
    deposit: policy.proposal_bond,
    gas: '50000000000000',
  };
}

/** The near CLI command that submits it; Tickmark never signs. */
export function nearCliCommand(call: ReturnType<typeof closingProposal>, signer: string, network: 'mainnet' | 'testnet'): string {
  const json = JSON.stringify(call.args).replace(/'/g, "'\\''");
  return [
    `near contract call-function as-transaction ${call.contract} add_proposal`,
    `json-args '${json}'`,
    `prepaid-gas '50 Tgas' attached-deposit '${call.deposit} yoctoNEAR'`,
    `sign-as ${signer} network-config ${network} sign-with-keychain send`,
  ].join(' \\\n  ');
}

/** Who may add a "vote" proposal under the DAO's policy (roles with *:AddProposal or vote:AddProposal). */
export function mayPropose(policy: DaoPolicy, account: string): { allowed: boolean; roles: string[] } {
  const roles = policy.roles
    .filter((r) => r.permissions.some((p) => p === '*:*' || p === '*:AddProposal' || p === 'vote:*' || p === 'vote:AddProposal'))
    .filter((r) => {
      const kind = r.kind as unknown;
      if (kind === 'Everyone') return true;
      if (kind && typeof kind === 'object' && 'Group' in kind) return ((kind as { Group: string[] }).Group ?? []).includes(account);
      return false; // token-weighted Member roles need a balance check Tickmark does not make
    })
    .map((r) => r.name);
  return { allowed: roles.length > 0, roles };
}

export type Closing = {
  proposalId: number;
  status: ProposalStatus;
  fingerprint: string;
  asOfBlock: number | null;
  title: string;
  proposer: string;
  submittedAt: string;
  votes: Record<string, string>;
};

/** Every close-the-books proposal among `proposals`, newest first. */
export function findClosings(proposals: Proposal[]): Closing[] {
  const out: Closing[] = [];
  for (const p of proposals) {
    if (p.kind !== 'Vote') continue;
    const d = parseDescription(p.description);
    const m = FINGERPRINT.exec((d.fields[REPORT_FIELD] ?? '').trim());
    if (!m) continue;
    const block = Number(d.fields['as of block']);
    out.push({
      proposalId: p.id,
      status: p.status,
      fingerprint: m[1]!,
      asOfBlock: Number.isSafeInteger(block) && block > 0 ? block : null,
      title: d.fields.title ?? '',
      proposer: p.proposer,
      submittedAt: new Date(nsToMs(p.submission_time)).toISOString(),
      votes: p.votes ?? {},
    });
  }
  return out.sort((a, b) => b.proposalId - a.proposalId);
}
