// Tickmark command line.
//   node cli/tickmark.ts scan   <dao> [options]   every money movement, valued
//   node cli/tickmark.ts books  <dao> [options]   the books: categories, journal, monthly spending, questions, report
//   node cli/tickmark.ts verify <report.json>      rebuild a report from the chain and compare fingerprints
//   node cli/tickmark.ts close  <report.json>      draft the proposal that asks the council to approve a report
//   node cli/tickmark.ts closings <dao>            list a DAO's close-the-books proposals and votes
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { centsToString, type JournalEntry } from '../core/books.ts';
import { closingProposal, findClosings, mayPropose, nearCliCommand } from '../core/closing.ts';
import { fetchPolicy, fetchProposals, NotADao } from '../core/dao.ts';
import { kindName } from '../core/decode.ts';
import { exportBooks } from '../core/exports.ts';
import { type QuestionKind } from '../core/questions.ts';
import { fingerprintOf, firstDifference, type SignedReport } from '../core/report.ts';
import { Rpc, type Network } from '../core/rpc.ts';
import { bookingTime } from '../core/types.ts';
import { suspenseGroups } from '../core/suggest.ts';
import { suggest } from './near-ai.ts';
import { load, makeBooks, VERSION, type PipelineOptions } from './pipeline.ts';

// NEAR_AI_API_KEY may live in .env (git-ignored). Never required: without it, --suggest runs in practice mode.
try {
  process.loadEnvFile('.env');
} catch {
  // no .env: fine
}

const USAGE = `Usage:
  node cli/tickmark.ts scan  <dao-account> [options]   list every money movement with its USD value
  node cli/tickmark.ts books <dao-account> [options]   categories, journal, monthly spending and suspense
  node cli/tickmark.ts verify <report.json>            rebuild a report from the chain; show any vote that approved it
  node cli/tickmark.ts close <report.json> [--signer ACCOUNT]   draft the close-the-books proposal (you sign, not Tickmark)
  node cli/tickmark.ts closings <dao-account>          list the DAO's close-the-books proposals and how the council voted

Options:
  --since YYYY-MM-DD   first day to include (default: first day of the price snapshot)
  --network NAME       mainnet (default) or testnet
  --lines              print every line, not just the totals
  --json FILE          write everything Tickmark derived to FILE
  --skip-dates         book payments on their submission date instead of looking up when they were paid

Options for books:
  --out DIR            write the bookkeeper's files to DIR (journal, QuickBooks, Xero, chart of accounts,
                       monthly spending, questions, and about-these-files.txt explaining them)
  --xero-tax-rate NAME tax rate name for the Xero file (default "Tax Exempt")
  --block HEIGHT       build the books as of an earlier block (reads from an archival node)
  --suggest            ask a NEAR AI model running in a TEE to suggest an account for each Suspense payee
                       (needs NEAR_AI_API_KEY in .env; without it, practice mode sends nothing). Checks the
                       attestation (fresh nonce) and the reply's signature; writes suggestions.json with --out
  --notes FILE         private notes for --suggest (vendor list, agreements), sent only inside the encrypted request
  --model ID           NEAR AI model for --suggest (default z-ai/glm-5.3-flash; must be a verifiable TEE model)

  Every run reads the chain at one block and prints the report's fingerprint (SHA-256). --out also writes
  report.json, which anyone can check with:
  node cli/tickmark.ts verify <report.json>

Examples:
  node cli/tickmark.ts scan daocubator.sputnik-dao.near --lines
  node cli/tickmark.ts books daocubator.sputnik-dao.near --out out/daocubator
  node cli/tickmark.ts verify out/daocubator/report.json`;


type Options = PipelineOptions & { lines: boolean; json?: string; out?: string; xeroTaxRate?: string; suggest: boolean; notes?: string; model?: string; signer?: string };

const usd = (n: number) => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const oneLine = (s: string) => s.replace(/<br>/gi, ' ').replace(/\s+/g, ' ').trim();

async function scan(dao: string, options: Options) {
  const { sinceDate, proposals, valued, dating } = await load(dao, options);
  const executed = valued.filter((m) => m.executed);

  console.log(`${dao} (${options.network}) since ${sinceDate}`);
  const kinds = new Map<string, number>();
  for (const p of proposals) kinds.set(kindName(p.kind), (kinds.get(kindName(p.kind)) ?? 0) + 1);
  console.log(`  ${proposals.length} proposals: ${[...kinds].map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}`);
  console.log(`  ${valued.length} money movements, ${executed.length} executed`);
  console.log(`  Payment dates: ${dating}`);

  const byToken = new Map<string, { count: number; quantity: number; usd: number; unpriced: number }>();
  for (const m of executed) {
    const t = byToken.get(m.symbol) ?? { count: 0, quantity: 0, usd: 0, unpriced: 0 };
    t.count++;
    t.quantity += Number(m.quantity);
    if (m.usd === null) t.unpriced++;
    else t.usd += m.usd;
    byToken.set(m.symbol, t);
  }
  console.log(`  Executed movements by token (includes moves between the treasury's own balances; see "books" for spending):`);
  for (const [symbol, t] of [...byToken].sort((a, b) => b[1].usd - a[1].usd)) {
    const value = t.unpriced === t.count ? 'no trusted price' : usd(t.usd) + (t.unpriced ? ` (+${t.unpriced} unpriced)` : '');
    console.log(`    ${symbol.padEnd(18)} ${String(t.count).padStart(4)} lines  ${t.quantity.toLocaleString('en-US', { maximumFractionDigits: 2 }).padStart(18)}  ${value}`);
  }
  const notes = valued.filter((m) => m.note);
  if (notes.length) console.log(`  ${notes.length} movements with notes, e.g. ${notes[0]!.note}`);

  if (options.lines) {
    console.log('\n  paid on     #id    status      via               amount                     usd  to / memo');
    for (const m of valued) {
      const amount = `${Number(m.quantity).toLocaleString('en-US', { maximumFractionDigits: 4 })} ${cut(m.symbol, 8)}`;
      const flag = m.dateSource === 'submitted' ? '*' : ' ';
      console.log(
        `  ${day(bookingTime(m))}${flag} ${String('#' + m.proposalId).padEnd(6)} ${m.status.padEnd(11)} ${m.via.padEnd(17)} ${amount.padStart(24)} ${(m.usd === null ? '—' : usd(m.usd)).padStart(10)}  ${cut(m.to, 24)} | ${cut(oneLine(m.memo) || '(no memo)', 50)}`,
      );
    }
  }
  if (options.json) {
    writeFileSync(options.json, JSON.stringify({ dao, network: options.network, since: sinceDate, movements: valued }, null, 2));
    console.log(`\n  wrote ${valued.length} movements to ${options.json}`);
  }
}

async function books(dao: string, options: Options) {
  const { sinceDate, asOf, dating, entries, st, questions, report, balances, opening, payees } = await makeBooks(dao, options);
  const money = (cents: number) => usd(cents / 100).padStart(14);

  console.log(`${dao} (${options.network}) since ${sinceDate}, as of block ${asOf.height} (${new Date(asOf.timestampMs).toISOString()}): ${entries.length} paid lines`);
  console.log(`  Payment dates: ${dating}`);
  const section = (title: string, which: string) => {
    const rows = st.rows.filter((r) => r.section === which);
    if (!rows.length) return;
    console.log(`\n  ${title}`);
    for (const r of rows) {
      const unpriced = r.unpriced ? `  (+${r.unpriced} without a price)` : '';
      console.log(`    ${r.code}  ${r.name.padEnd(42)} ${money(r.totalCents)}  ${String(r.count).padStart(4)} lines${unpriced}`);
    }
  };
  section('Spending', 'expense');
  console.log(`          ${'Total spending'.padEnd(42)} ${money(st.spendingCents)}`);
  section('Not explained yet (the treasurer is asked about each one)', 'suspense');
  section('Not spending: the money is still the treasury’s, in another form or place', 'balance_sheet');

  const basis = new Map<string, number>();
  for (const e of entries) basis.set(e.basis, (basis.get(e.basis) ?? 0) + 1);
  const pct = (n: number) => `${Math.round((100 * n) / Math.max(entries.length, 1))}%`;
  console.log(
    `\n  How lines were placed: chain facts ${basis.get('chain') ?? 0} (${pct(basis.get('chain') ?? 0)}), payee's own-name account ${basis.get('account_name') ?? 0}, proposal words ${basis.get('memo') ?? 0} (${pct(basis.get('memo') ?? 0)}), ` +
      `payee history ${basis.get('payee_history') ?? 0} (${pct(basis.get('payee_history') ?? 0)}), not placed ${basis.get('none') ?? 0} (${pct(basis.get('none') ?? 0)})`,
  );

  const n = (s: string | null) => (s === null ? '?' : Number(s).toLocaleString('en-US', { maximumFractionDigits: 2 }));
  const verdict = { ties: 'ties out', received: 'received from outside the proposals', unexplained_outflow: 'MONEY LEFT UNSEEN (question asked)', unreadable: 'could not be read' };
  console.log(`\n  Balances checked against the chain (opening: block ${opening.height}, ${new Date(opening.timestampMs).toISOString().slice(0, 10)}; closing: block ${asOf.height}):`);
  console.log(`    ${'token'.padEnd(10)} ${'place'.padEnd(8)} ${'opening'.padStart(16)} ${'− paid out'.padStart(16)} ${'+ moved in'.padStart(14)} ${'+ other in'.padStart(16)} ${'= closing'.padStart(16)}`);
  for (const b of balances) {
    console.log(`    ${cut(b.symbol, 10).padEnd(10)} ${b.location.padEnd(8)} ${n(b.opening).padStart(16)} ${n(b.bookedOut).padStart(16)} ${n(b.movedIn).padStart(14)} ${n(b.otherIn).padStart(16)} ${n(b.closing).padStart(16)}  ${verdict[b.status]}`);
  }

  const suspense = entries.filter((e) => e.section === 'suspense').sort((a, b) => (b.cents ?? 0) - (a.cents ?? 0));
  if (suspense.length) {
    console.log(`\n  Largest lines in Suspense:`);
    for (const e of suspense.slice(0, options.lines ? suspense.length : 8)) printEntry(e);
  }
  const kindLabel = { named: '', unnamed: ' (no name)', dao: ' (DAO)', own_name: " (the DAO's own name)" } as const;
  console.log(`\n  Payees (${payees.length}), largest first:`);
  for (const p of payees.slice(0, options.lines ? payees.length : 8)) {
    const flags = [p.roles.length ? `role: ${p.roles.join(', ')}` : '', p.votedOnOwn.length ? `voted on own payment ${p.votedOnOwn.length}x` : '', p.questions ? `${p.questions} question${p.questions === 1 ? '' : 's'}` : ''].filter(Boolean).join('; ');
    console.log(`    ${cut(p.account, 30).padEnd(30)} ${(p.cents === null ? 'no price' : usd(p.cents / 100)).padStart(14)}  ${String(p.lines).padStart(3)} lines  ${p.categories.map((c) => c.category).join(', ')}${kindLabel[p.kind]}${flags ? `  [${flags}]` : ''}`);
  }
  const kinds = new Map<QuestionKind, number>();
  for (const q of questions) kinds.set(q.kind, (kinds.get(q.kind) ?? 0) + 1);
  console.log(`\n  ${questions.length} questions for the treasurer: ${[...kinds].map(([k, n]) => `${k.replace(/_/g, ' ')} ${n}`).join(', ') || 'none'}`);
  for (const q of questions.slice(0, options.lines ? questions.length : 12)) {
    console.log(`    • ${q.ask}`);
    if (options.lines) for (const f of q.facts) console.log(`        ${cut(f, 150)}`);
  }
  if (options.lines) {
    console.log(`\n  Journal (${entries.length} entries):`);
    for (const e of entries) printEntry(e, true);
  }
  console.log(`\n  Report fingerprint (sha256): ${report.fingerprint}`);
  if (options.json) {
    writeFileSync(options.json, JSON.stringify(report, null, 2));
    console.log(`  wrote the report to ${options.json}`);
  }
  if (options.out) {
    const files = [
      ...exportBooks(
        {
          dao,
          network: options.network,
          since: sinceDate,
          entries,
          statement: st,
          questions,
          balances: { checks: balances, openingBlock: opening.height, openingDate: sinceDate, closingBlock: asOf.height },
          payees,
        },
        { xeroTaxRate: options.xeroTaxRate },
      ),
      { name: 'report.json', content: JSON.stringify(report, null, 2) },
    ];
    mkdirSync(options.out, { recursive: true });
    for (const f of files) writeFileSync(join(options.out, f.name), f.content);
    console.log(`  wrote ${files.length} files to ${options.out}: ${files.map((f) => f.name).join(', ')}`);
  }
  if (options.suggest) await suggestForSuspense(dao, report.fingerprint, entries, options);
}

/** Private suggestions for Suspense (NEAR AI, TEE), kept apart from the books. */
async function suggestForSuspense(dao: string, fingerprint: string, entries: JournalEntry[], options: Options) {
  const groups = suspenseGroups(entries);
  console.log(`\n  Suggestions for ${groups.length} payee${groups.length === 1 ? '' : 's'} in Suspense${groups.length ? '' : ': nothing to suggest'}`);
  if (!groups.length) return;
  const notes = options.notes ? readFileSync(options.notes, 'utf8') : undefined;
  const file = await suggest({
    dao,
    reportFingerprint: fingerprint,
    groups,
    apiKey: process.env.NEAR_AI_API_KEY || undefined,
    model: options.model,
    notes,
    onStep: (s) => console.log(`    … ${s}`),
  });
  for (const s of file.suggestions) {
    console.log(`    • ${cut(s.payee, 30)} → ${s.categoryName} (${s.confidence}): ${s.reason}`);
    console.log(`        ask: ${s.question}`);
  }
  for (const p of file.problems) console.log(`    ! ${p}`);
  const v = file.verification;
  if (v) {
    console.log('\n  Verified:');
    console.log(`    ✓ ${v.model} is listed by NEAR AI as a verifiable TEE model`);
    console.log(`    ✓ attestation fetched with a fresh nonce (${v.attestation.nonces.map((n) => n.slice(0, 16) + '…').join(', ') || 'nonce inside the SDK'}) and verified; TCB ${v.attestation.tcbStatus ?? 'n/a'}; GPU ${v.attestation.gpuEvidence ?? 'n/a'}`);
    console.log(`    ✓ request end-to-end encrypted to the attested model key`);
    console.log(`    ✓ reply signed by ${v.replySignature.signer} (${v.replySignature.kind}); signature checked`);
    console.log(`    ✓ nothing stored on a server: Tickmark has none${notes ? '; your notes were sent only inside the encrypted request' : ''}`);
  } else {
    console.log('\n  PRACTICE MODE (no NEAR_AI_API_KEY): no AI was called, nothing was sent, nothing is verified.');
  }
  if (options.out) {
    writeFileSync(join(options.out, 'suggestions.json'), JSON.stringify(file, null, 2));
    console.log(`  wrote ${join(options.out, 'suggestions.json')} (separate from the books; it never changes report.json)`);
  }
}

/** Checks a report: its fingerprint matches its content, and rebuilding it from the chain gives the same fingerprint. */
async function verify(file: string, options: Options) {
  const saved = JSON.parse(readFileSync(file, 'utf8')) as SignedReport;
  const intact = (await fingerprintOf(saved)) === saved.fingerprint;
  console.log(`${file}: ${saved.dao} (${saved.network}) since ${saved.since}, as of block ${saved.asOf.block}`);
  console.log(`  fingerprint in the file:      ${saved.fingerprint}`);
  console.log(`  the file's content hashes to: ${intact ? 'the same (the file was not edited)' : await fingerprintOf(saved)}`);
  if (saved.tickmark !== VERSION) console.log(`  note: built by Tickmark ${saved.tickmark}, checking with ${VERSION}; different rules can give different books.`);
  console.log(`  rebuilding from the chain at block ${saved.asOf.block} (archival node)...`);
  const { report } = await makeBooks(saved.dao, { ...options, network: saved.network as Network, since: saved.since, block: saved.asOf.block });
  const same = report.fingerprint === saved.fingerprint;
  console.log(`  rebuilt fingerprint:          ${report.fingerprint}`);
  const votes = (await daoClosings(saved.dao, saved.network as Network)).filter((c) => c.fingerprint === saved.fingerprint);
  for (const c of votes) console.log(`  closed by vote: proposal #${c.proposalId} is ${c.status} (${Object.entries(c.votes).map(([who, v]) => `${who} ${v}`).join(', ') || 'no votes yet'})`);
  if (!votes.length) console.log('  closed by vote: no proposal in this DAO carries this fingerprint yet');
  if (same && intact) {
    console.log('\n  VERIFIED: the report matches the chain.');
    return;
  }
  const diff = firstDifference({ ...saved, fingerprint: undefined }, { ...report, fingerprint: undefined });
  if (diff) console.log(`\n  first difference at ${diff.path}:\n    file:    ${cut(JSON.stringify(diff.a), 160)}\n    rebuilt: ${cut(JSON.stringify(diff.b), 160)}`);
  console.log('\n  NOT VERIFIED.');
  process.exitCode = 1;
}

/** Every close-the-books proposal of a DAO (all of its history), read at the latest final block. */
async function daoClosings(dao: string, network: Network) {
  return findClosings(await fetchProposals(new Rpc({ network }), dao, 0));
}

/** Lists a DAO's close-the-books proposals and how the council voted. */
async function closings(dao: string, options: Options) {
  const found = await daoClosings(dao, options.network);
  console.log(`${dao} (${options.network}): ${found.length} close-the-books proposal${found.length === 1 ? '' : 's'}`);
  for (const c of found) {
    console.log(`  #${c.proposalId}  ${c.status.padEnd(10)}  ${c.title}  (as of block ${c.asOfBlock ?? '?'}, proposed by ${c.proposer} on ${c.submittedAt.slice(0, 10)})`);
    console.log(`        report sha256:${c.fingerprint}`);
    console.log(`        votes: ${Object.entries(c.votes).map(([who, v]) => `${who} ${v}`).join(', ') || 'none yet'}`);
  }
  if (found.length) console.log('\n  To check one: get its report.json and run `node cli/tickmark.ts verify report.json`.');
}

/** Prints the proposal that asks the council to approve a report. Tickmark never signs; a council member does. */
async function close(file: string, options: Options) {
  const saved = JSON.parse(readFileSync(file, 'utf8')) as SignedReport;
  if ((await fingerprintOf(saved)) !== saved.fingerprint) {
    console.error(`${file} was edited after it was made (its content no longer matches its fingerprint). Rebuild it with books --out.`);
    process.exit(1);
  }
  const network = saved.network as Network;
  const policy = await fetchPolicy(new Rpc({ network }), saved.dao);
  const call = closingProposal(saved, policy);
  console.log(`Close the books of ${saved.dao}, ${saved.since} to block ${saved.asOf.block}: report sha256:${saved.fingerprint}\n`);
  console.log(`Proposal (kind "Vote": text only, it moves no money). Bond: ${Number(BigInt(policy.proposal_bond) / 10n ** 21n) / 1000} NEAR, returned when the proposal passes.\n`);
  console.log(call.args.proposal.description.split(' <br>').join('\n'));
  if (options.signer) {
    const who = mayPropose(policy, options.signer);
    console.log(`\n${options.signer} ${who.allowed ? `may propose it (role: ${who.roles.join(', ')})` : 'is not in a role that may add vote proposals under this policy; a council member should submit it'}.`);
  }
  console.log(`\nA council member submits it with near CLI (Tickmark never signs):\n\n${nearCliCommand(call, options.signer ?? '<your-account.near>', network)}\n`);
  console.log(`Then the council votes as usual. Anyone can confirm afterwards with: node cli/tickmark.ts verify ${file}`);
}

function printEntry(e: JournalEntry, withEvidence = false) {
  const value = e.cents === null ? `${e.quantity} ${e.symbol}` : `$${Number(centsToString(e.cents)).toLocaleString('en-US')}`;
  console.log(`    ${e.date}  #${String(e.proposalId).padEnd(5)} ${cut(value, 22).padStart(22)}  ${cut(e.payee, 28).padEnd(28)}  ${cut(e.memo || '(no memo)', 40)}`);
  if (withEvidence) console.log(`               ${e.category} ← ${cut(e.evidence, 140)}`);
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    since: { type: 'string' },
    network: { type: 'string', default: 'mainnet' },
    lines: { type: 'boolean', default: false },
    json: { type: 'string' },
    'skip-dates': { type: 'boolean', default: false },
    out: { type: 'string' },
    'xero-tax-rate': { type: 'string' },
    suggest: { type: 'boolean', default: false },
    notes: { type: 'string' },
    model: { type: 'string' },
    signer: { type: 'string' },
    block: { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

const [command, target] = positionals;
const commands = { scan, books, verify, close, closings } as const;
if (values.help || !target || !(command && command in commands)) {
  console.log(USAGE);
  process.exit(values.help ? 0 : 1);
}
if (values.network !== 'mainnet' && values.network !== 'testnet') {
  console.error('--network must be mainnet or testnet');
  process.exit(1);
}
const block = values.block === undefined ? undefined : Number(values.block);
if (block !== undefined && !(Number.isSafeInteger(block) && block > 0)) {
  console.error('--block must be a block height');
  process.exit(1);
}
try {
  await commands[command as keyof typeof commands](target, {
    since: values.since,
    network: values.network,
    lines: values.lines,
    json: values.json,
    skipDates: values['skip-dates'],
    out: values.out,
    xeroTaxRate: values['xero-tax-rate'],
    block,
    suggest: values.suggest,
    notes: values.notes,
    model: values.model,
    signer: values.signer,
  });
} catch (error) {
  // Not a DAO is the visitor's input, not a fault: say so in one line instead of a stack trace.
  if (!(error instanceof NotADao)) throw error;
  console.error(`${error.message}${error.kind === 'missing' ? ` (network: ${values.network})` : ''}`);
  process.exitCode = 1;
}
