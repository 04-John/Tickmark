// Tickmark's demo treasury on NEAR testnet, with problems planted on purpose, and closing its books by a real vote.
//
//   node scripts/demo-testnet.ts setup                 accounts, the DAO, and the planted proposals
//   node cli/tickmark.ts books <dao> --network testnet --out out/demo
//   node scripts/demo-testnet.ts close out/demo/report.json   the council approves the report by vote
//   node cli/tickmark.ts verify out/demo/report.json  shows the books match the chain and the vote that approved them
//
// Testnet only (test NEAR from the free faucet; nothing here has value). Keys are kept in
// .cache/demo-testnet.local.json, which git ignores. Each step is recorded there, so a rerun continues where it stopped.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { Account, JsonRpcProvider, KeyPair } from 'near-api-js';
import { closingProposal } from '../core/closing.ts';
import { fingerprintOf, type SignedReport } from '../core/report.ts';

const RPC = 'https://test.rpc.fastnear.com';
const FACTORY = 'sputnik-v2.testnet';
const STATE = '.cache/demo-testnet.local.json';
const NEAR = 10n ** 24n;
const near = (n: string) => {
  const [whole, frac = ''] = n.split('.');
  return (BigInt(whole!) * NEAR + BigInt((frac + '0'.repeat(24)).slice(0, 24))).toString();
};
const TGAS = 10n ** 12n;

type Keyed = { accountId: string; privateKey: string };
type State = { admin: Keyed; bob?: Keyed; studio?: Keyed; designer?: Keyed; unnamed?: string; dao?: string; done: string[]; proposals: Record<string, number> };

const provider = new JsonRpcProvider({ url: RPC });
const load = (): State => {
  if (!existsSync(STATE)) throw new Error(`${STATE} is missing: it needs an admin testnet account (create one with the faucet first).`);
  const s = JSON.parse(readFileSync(STATE, 'utf8')) as State;
  s.done ??= [];
  s.proposals ??= {};
  return s;
};
const save = (s: State) => writeFileSync(STATE, JSON.stringify(s, null, 2));
const account = (k: Keyed) => new Account(k.accountId, provider, k.privateKey as `ed25519:${string}`);
const step = async (s: State, name: string, run: () => Promise<void>) => {
  if (s.done.includes(name)) return;
  console.log(`… ${name}`);
  await run();
  s.done.push(name);
  save(s);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function subAccount(s: State, prefix: 'bob' | 'studio' | 'designer', amount: string) {
  await step(s, `create ${prefix}`, async () => {
    const key = KeyPair.fromRandom('ed25519');
    await account(s.admin).createSubAccount({ accountOrPrefix: prefix, publicKey: key.getPublicKey(), nearToTransfer: near(amount) });
    s[prefix] = { accountId: `${prefix}.${s.admin.accountId}`, privateKey: key.toString() };
  });
}

type Kind = { Transfer: { token_id: string; receiver_id: string; amount: string } } | 'Vote';

/** Adds a proposal as the admin and returns its id. */
async function propose(s: State, name: string, description: string, kind: Kind): Promise<number> {
  await step(s, `propose ${name}`, async () => {
    const id = await account(s.admin).callFunction<number>({
      contractId: s.dao!,
      methodName: 'add_proposal',
      args: { proposal: { description, kind } },
      deposit: near('0.01'),
      gas: 100n * TGAS,
    });
    s.proposals[name] = Number(id);
  });
  return s.proposals[name]!;
}

/** The proposal's status, read from the chain. */
async function statusOf(s: State, id: number): Promise<string> {
  const p = await provider.callFunction<{ status: string }>({ contractId: s.dao!, method: 'get_proposal', args: { id } });
  return p?.status ?? 'unknown';
}

async function approve(s: State, name: string, voter: Keyed, kind: Kind) {
  await step(s, `approve ${name} by ${voter.accountId.split('.')[0]}`, async () => {
    try {
      await account(voter).callFunction({
        contractId: s.dao!,
        methodName: 'act_proposal',
        args: { id: s.proposals[name], action: 'VoteApprove', proposal: kind },
        gas: 200n * TGAS,
      });
    } catch (error) {
      // A planted failing payment makes the transaction report a failure even though the vote went through.
      const status = await statusOf(s, s.proposals[name]!);
      if (status === 'InProgress') throw error;
      console.log(`  (the vote went through; the proposal is ${status}, and a receipt in its transaction failed)`);
    }
  });
}

const transfer = (to: string, amount: string): Kind => ({ Transfer: { token_id: '', receiver_id: to, amount: near(amount) } });

async function setup() {
  const s = load();
  await subAccount(s, 'bob', '0.5');
  await subAccount(s, 'studio', '0.2');
  await subAccount(s, 'designer', '0.2');
  s.unnamed ??= Buffer.from(KeyPair.fromRandom('ed25519').getPublicKey().data).toString('hex'); // an implicit (nameless) account
  save(s);

  const name = s.admin.accountId.replace(/\.testnet$/, '').replace(/[^a-z0-9-]/g, '-').slice(0, 40);
  await step(s, 'create the DAO', async () => {
    const policy = {
      roles: [{ name: 'council', kind: { Group: [s.admin.accountId, s.bob!.accountId] }, permissions: ['*:*'], vote_policy: {} }],
      default_vote_policy: { weight_kind: 'RoleWeight', quorum: '0', threshold: '1' }, // one council approval is enough
      proposal_bond: near('0.01'),
      proposal_period: String(10n * 60n * 1_000_000_000n), // 10 minutes, so an unanswered request goes stale during the demo
      bounty_bond: near('0.01'),
      bounty_forgiveness_period: String(24n * 3600n * 1_000_000_000n),
    };
    const config = { name, purpose: 'Tickmark demo treasury with planted problems (testnet)', metadata: '' };
    await account(s.admin).callFunction({
      contractId: FACTORY,
      methodName: 'create',
      args: { name, args: Buffer.from(JSON.stringify({ config, policy })).toString('base64') },
      deposit: near('6'),
      gas: 150n * TGAS,
    });
    s.dao = `${name}.${FACTORY}`;
  });
  await step(s, 'fund the DAO', async () => {
    await account(s.admin).transfer({ receiverId: s.dao!, amount: near('2') });
  });

  const studio = s.studio!.accountId;
  const designer = s.designer!.accountId;
  const bob = s.bob!;

  // 1. A clean, explained payment.
  const invoice41 = transfer(studio, '0.3');
  await propose(s, 'invoice 41', '* Title: Website design, invoice 41 <br>* Summary: Studio invoice 41 for the website redesign, 0.3 NEAR', invoice41);
  await approve(s, 'invoice 41', bob, invoice41);
  // 2. The same invoice paid again a minute later: a possible duplicate.
  await sleep(60_000);
  await propose(s, 'invoice 41 again', '* Title: Website design, invoice 41', invoice41);
  await approve(s, 'invoice 41 again', bob, invoice41);
  // 3. The description says 0.5 NEAR, the proposal sends 0.25.
  const logo = transfer(designer, '0.25');
  await propose(s, 'logo', '* Title: Logo design <br>* Summary: Final logo files, 0.5 NEAR as agreed', logo);
  await approve(s, 'logo', bob, logo);
  // 4. No description, to an account with no name.
  const mystery = transfer(s.unnamed!, '0.2');
  await propose(s, 'unnamed', '', mystery);
  await approve(s, 'unnamed', bob, mystery);
  // 5. A council member approves their own pay.
  const honorarium = transfer(bob.accountId, '0.15');
  await propose(s, 'honorarium', '* Title: Honorarium, November', honorarium);
  await approve(s, 'honorarium', bob, honorarium);
  // 6. A payment to an account that does not exist: it fails on chain, so the payee may still be owed.
  const ghost = transfer(`ghost.${s.admin.accountId}`, '0.1');
  await propose(s, 'failed', '* Title: Translation services, invoice 7', ghost);
  await approve(s, 'failed', s.admin, ghost);
  // 7. A request nobody answers: after the 10-minute voting period it is open past its period.
  await propose(s, 'unanswered', '* Title: Hosting, invoice 43', transfer(studio, '0.2'));

  console.log(`\nDemo treasury: ${s.dao}`);
  console.log(`Proposals: ${Object.entries(s.proposals).map(([k, v]) => `#${v} ${k}`).join(', ')}`);
  console.log(`Wait 10 minutes (the voting period), then:\n  node cli/tickmark.ts books ${s.dao} --network testnet --out out/demo`);
}

/** The admin proposes closing the books with a report's fingerprint; bob (the other council member) approves it. */
async function close(file: string) {
  const s = load();
  const report = JSON.parse(readFileSync(file, 'utf8')) as SignedReport;
  if (report.dao !== s.dao || report.network !== 'testnet') throw new Error(`${file} is not a report of ${s.dao} on testnet`);
  if ((await fingerprintOf(report)) !== report.fingerprint) throw new Error(`${file} was edited after it was made`);
  const call = closingProposal(report, { proposal_bond: near('0.01') });
  const key = `close ${report.fingerprint.slice(0, 12)}`;
  const id = await propose(s, key, call.args.proposal.description, 'Vote');
  await approve(s, key, s.bob!, 'Vote');
  console.log(`Closed by vote: proposal #${id} carries report sha256:${report.fingerprint} and was approved by ${s.bob!.accountId}.`);
  console.log(`Check: node cli/tickmark.ts verify ${file}`);
}

const [command, arg] = process.argv.slice(2);
if (command === 'setup') await setup();
else if (command === 'close' && arg) await close(arg);
else {
  console.log('Usage: node scripts/demo-testnet.ts setup | close <report.json>');
  process.exit(1);
}
