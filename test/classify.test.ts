import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assetAccount, categoryFromWords, classify, type Classified } from '../core/classify.ts';
import { decodeProposal } from '../core/decode.ts';
import { parseDescription } from '../core/describe.ts';
import { KNOWN_TOKENS } from '../core/tokens.ts';
import type { Movement, Proposal } from '../core/types.ts';
import { formatUnits } from '../core/units.ts';
import type { ValuedMovement } from '../core/value.ts';
import * as fx from './fixtures/proposals.ts';

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64');

/** Values a movement without the network: known tokens at $2 (stables at $1), unknown tokens unpriced. */
function valued(m: Movement): ValuedMovement {
  const token = KNOWN_TOKENS[m.token];
  const decimals = token?.decimals ?? 0;
  const quantity = formatUnits(m.amount, decimals);
  const unitPrice = token ? (token.price === 'usd' ? 1 : 2) : null;
  return { ...m, symbol: token?.symbol ?? m.token, decimals, quantity, unitPrice, usd: unitPrice === null ? null : Number(quantity) * unitPrice, priceDate: unitPrice === null ? null : '2026-03-02' };
}

const run = (...proposals: Proposal[]): Classified[] => classify(proposals.flatMap((p) => decodeProposal(fx.DAO, p)).map(valued));
const proposal = (id: number, kind: Proposal['kind'], description: string, extra: Partial<Proposal> = {}): Proposal => ({ ...fx.nativeTransfer, id, kind, description, ...extra });
const near = (n: number) => (BigInt(n) * 10n ** 24n).toString();

test('descriptions: Trezu fields, the human note, and nothing Trezu wrote itself', () => {
  const d = parseDescription(
    '* Proposal Action: asset-exchange <br>* Notes: **Must be executed before 2026-04-23T17:18:28.782Z** for transferring tokens to 1Click <br>* Amount Out: 15003.9 <br>* Deposit Address: b862',
  );
  assert.equal(d.fields['proposal action'], 'asset-exchange');
  assert.equal(d.fields['amount out'], '15003.9');
  assert.equal(d.text, '', 'the deadline note is machine-written');
  assert.equal(parseDescription('* Title: Design services <br>* Summary: Design services').text, 'Design services', 'title and summary are not repeated');
  assert.equal(parseDescription('Send protocol fee to [the fee account](https://x.y/z)').text, 'Send protocol fee to the fee account');
  assert.equal(parseDescription(null).text, '');
});

test('words place a payment, in a fixed order', () => {
  const cat = (text: string) => categoryFromWords(text)?.category ?? null;
  assert.equal(cat('Design services for March — Invoice #12'), 'contractors');
  assert.equal(cat('Refund of unused grant'), 'refunds', 'refund wins over grant');
  assert.equal(cat('Kraken'), 'exchanges');
  assert.equal(cat('apply 100K as reward for trading contest'), 'bounties');
  assert.equal(cat('Send protocol fee USM to the fee account'), 'distributions');
  assert.equal(cat('Honorarium'), 'payroll');
  assert.equal(cat('May Expenses'), 'travel');
  assert.equal(cat('transfer to Eth multisig'), 'own_wallets');
  assert.equal(cat('inv 47, 48'), 'contractors');
  assert.equal(cat('Payment Request — inv40'), 'contractors');
  assert.equal(cat('investment round'), null, '"inv" counts only as an abbreviation');
  assert.equal(cat('Q3 payment to Cavenwell'), null);
  assert.equal(cat('nov/dec'), null);
});

test('asset accounts: one per known token and place; unknown tokens share one', () => {
  assert.deepEqual(assetAccount('near', 'wallet'), { code: '1110', name: 'Digital assets: NEAR' });
  assert.deepEqual(assetAccount('wrap.near', 'wallet'), { code: '1111', name: 'Digital assets: wNEAR' });
  assert.deepEqual(assetAccount('usdt.tether-token.near', 'intents'), { code: '1213', name: 'NEAR Intents balance: USDt' });
  assert.deepEqual(assetAccount('near', 'staked'), { code: '1310', name: 'Staked: NEAR' });
  assert.deepEqual(assetAccount('meme.near', 'wallet'), { code: '1190', name: 'Digital assets: other tokens' });
});

test('memo words: a contractor invoice is an expense paid from the wallet', () => {
  const [c] = run(fx.nativeTransfer);
  assert.deepEqual([c!.booking?.category, c!.booking?.basis, c!.booking?.debit.code, c!.booking?.credit.code], ['contractors', 'memo', '6020', '1110']);
  assert.match(c!.booking!.evidence, /“services”|“Services”|“Design”|“design”/);
  assert.equal(c!.payee, 'designer.near');
});

test('chain facts: deposit to own Intents balance, staking, wrapping, protocol deposit', () => {
  const [ownIntents] = run(fx.swapDeposit);
  assert.deepEqual([ownIntents!.booking?.category, ownIntents!.booking?.debit.name, ownIntents!.booking?.credit.name], ['internal', 'NEAR Intents balance: USDt', 'Digital assets: USDt']);

  const [staked] = run(fx.staking);
  assert.deepEqual([staked!.booking?.rule, staked!.booking?.debit.name], ['stake_near', 'Staked: NEAR']);

  const ref = proposal(30, { FunctionCall: { receiver_id: 'usdt.tether-token.near', actions: [{ method_name: 'ft_transfer_call', args: b64({ receiver_id: 'v2.ref-finance.near', amount: '9', msg: '' }), deposit: '1', gas: '0' }] } }, 'add liquidity');
  assert.equal(run(ref)[0]!.booking?.category, 'protocols', 'tokens sent into a protocol are still the treasury’s, not spending');
});

test('a Trezu NEAR payment is a wrap (internal) plus a payment to the named recipient', () => {
  const trezuPay = proposal(
    31,
    {
      FunctionCall: {
        receiver_id: 'wrap.near',
        actions: [
          { method_name: 'near_deposit', args: b64({}), deposit: near(500), gas: '0' },
          { method_name: 'ft_transfer', args: b64({ receiver_id: 'aa'.repeat(32), amount: near(500) }), deposit: '1', gas: '0' },
        ],
      },
    },
    `* Proposal Action: payment-transfer <br>* Notes: Audit invoice 7 <br>* Recipient: auditor.near <br>* Destination Network: near.com <br>* Deposit Address: ${'aa'.repeat(32)}`,
  );
  const [wrap, pay] = run(trezuPay);
  assert.deepEqual([wrap!.booking?.rule, wrap!.payee, wrap!.booking?.debit.name, wrap!.booking?.credit.name], ['wrap_near', 'wrap.near', 'Digital assets: wNEAR', 'Digital assets: NEAR']);
  assert.deepEqual([pay!.payee, pay!.booking?.category, pay!.booking?.credit.name], ['auditor.near', 'contractors', 'Digital assets: wNEAR']);
  assert.match(pay!.booking!.evidence, /^Trezu payment to auditor\.near through deposit address aaaaaa…aaaa; /);
});

test('a Trezu swap is not spending', () => {
  const swap = proposal(
    32,
    { FunctionCall: { receiver_id: 'usdt.tether-token.near', actions: [{ method_name: 'ft_transfer', args: b64({ receiver_id: 'bb'.repeat(32), amount: '15120000000' }), deposit: '1', gas: '0' }] } },
    `* Proposal Action: asset-exchange <br>* Notes: **Must be executed before 2026-04-23T17:18:28.782Z** for transferring tokens <br>* Token Out Address: nep141:wrap.near <br>* Amount Out: 5000.5 <br>* Deposit Address: ${'bb'.repeat(32)}`,
  );
  const [c] = run(swap);
  assert.deepEqual([c!.booking?.category, c!.booking?.debit.code, c!.memoText], ['swaps', '1940', '']);
  assert.match(c!.booking!.evidence, /15,120 USDt sent to 1Click deposit address bbbbbb…bbbb, for about 5000\.5 of wrap\.near/);
});

test('payee history fills in a memo-less payment only when earlier placements agree', () => {
  const pay = (id: number, to: string, description: string) => proposal(id, { Transfer: { token_id: '', receiver_id: to, amount: near(1), msg: null } }, description);
  const out = run(pay(40, 'alice.near', 'Honorarium, October'), pay(41, 'alice.near', ''), pay(42, 'bob.near', 'Grant milestone 1'), pay(43, 'bob.near', 'Audit work'), pay(44, 'bob.near', 'nov'));
  const byId = new Map(out.map((c) => [c.proposalId, c.booking!]));
  assert.deepEqual([byId.get(41)!.category, byId.get(41)!.basis], ['payroll', 'payee_history']);
  assert.match(byId.get(41)!.evidence, /#40 paid alice\.near as Contributor pay/);
  assert.equal(byId.get(44)!.category, 'suspense', 'bob was paid as a grant and as a contractor, so nothing is guessed');
  assert.match(byId.get(44)!.evidence, /Grants and Contractors and services/);
});

test('other DAOs, unpaid proposals, and unexplained payments', () => {
  const toDao = proposal(50, { Transfer: { token_id: '', receiver_id: 'guild.sputnik-dao.near', amount: near(10), msg: null } }, '');
  const unexplained = proposal(51, { Transfer: { token_id: 'meme.near', receiver_id: 'cc'.repeat(32), amount: '5', msg: null } }, '');
  const [dao, failed, mystery] = run(toDao, fx.failedTransfer, unexplained);
  assert.deepEqual([dao!.booking?.category, dao!.booking?.basis], ['other_daos', 'chain']);
  assert.equal(failed!.booking, null);
  assert.deepEqual([mystery!.booking?.category, mystery!.booking?.credit.name, mystery!.booking?.evidence], ['suspense', 'Digital assets: other tokens', 'the proposal has no description']);
});
