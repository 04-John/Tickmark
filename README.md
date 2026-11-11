# Tickmark

Books and audit questions for any NEAR treasury, read straight from the chain.

Point Tickmark at a Sputnik DAO or Trezu treasury. It lists every payment the treasury made, dates each one by the vote that paid it, values it in US dollars on that day, and places it in a chart of accounts with the reason why. It checks the balances against the chain and lists the questions an auditor would ask the treasurer. It also writes files that QuickBooks, Xero or a spreadsheet can open. Built at NEAR HACKATHON (November 2026).

> **Status: work in progress (day 1 of 4).** Everything under [Try it](#try-it) works today. Sections marked *(building)* are planned and not done yet. This note goes away when they are.

## Why

In the 12 months to 11 November 2026, 92 NEAR DAOs paid out **$99.9M** to other accounts. For **$67.8M (68%)** of it, nothing in the proposal, the chain or the payee's history says what it was for. **$59.5M (60%)** went out on a proposal whose description is empty or a single word like "transfer". Test DAOs, swaps, wrapped NEAR, staking, loans, and moves between a treasury's own accounts are not counted.

These are Tickmark's own numbers. To rebuild them (about 15 minutes, free public endpoints):

```sh
node scripts/measure.ts data/measure/daos.txt --summary my-summary.json
```

[data/measure/last-12-months.json](data/measure/last-12-months.json) has the totals, the definitions, and each DAO's block and report fingerprint, so any one DAO can be checked with `books`. It deliberately has no per-DAO dollar figures.

## Who it's for

The bookkeeper or treasurer of a team that pays people from a NEAR DAO. Today they rebuild the books by hand from a block explorer, one proposal at a time, and guess what payments without a memo were for. Tickmark does the reading, decoding, dating, pricing and placing. It leaves them only the questions a person has to answer.

## Try it

You need Node.js 24 or newer. No keys and no wallet: everything is read from public NEAR data.

```sh
npm ci
npm run check          # type check + unit tests, no network needed
```

**Do:** build the books of a real treasury for the last 12 months, and write the bookkeeper's files:

```sh
node cli/tickmark.ts books daocubator.sputnik-dao.near --out out/daocubator
```

**See:**
- spending by account, what is not explained yet, and what is not spending (swaps, wrapped NEAR, money moved between the treasury's own balances);
- the balances checked against the chain: `USDC.e  wallet  11,087 − 8,636.14 + 0 + 0 = 2,450.86  ties out`;
- the questions for the treasurer, such as `taoist.near voted to approve 6 proposals that paid them $3,492 (#141, #142, #145, #146, #148 and #149). Did someone other than the payee review them?`;
- the report's fingerprint (SHA-256), and the files in `out/daocubator/`.

**Do:** check that report against the chain:

```sh
node cli/tickmark.ts verify out/daocubator/report.json
```

**See:** `VERIFIED: the report matches the chain.` Tickmark rebuilds the books from an archival node at the block the report was made at, and gets the same fingerprint. Edit any value in report.json and it says where: `first difference at journal[0].payee`.

Other commands:

| Do | See |
| --- | --- |
| `node cli/tickmark.ts books <dao> --lines` | every journal line with its evidence, and the facts behind each question |
| `node cli/tickmark.ts scan <dao> --lines` | every money movement the proposals made, paid or not |
| `node cli/tickmark.ts scan <dao> --json scan.json` then `node scripts/check-dates.ts scan.json` | each payment date proven from chain state alone: the proposal is in progress just before that block and approved after it (daocubator 20/20, n1-treasury 204/204) |
| `node scripts/check-tokens.ts` | every priced token's decimals checked against the chain |

Options: `--since YYYY-MM-DD`, `--network testnet`, `--block HEIGHT` (the books as of an earlier block), `--json FILE`, `--xero-tax-rate NAME`.

## The files (`--out DIR`)

| File | What it is |
| --- | --- |
| `journal.csv` | one row per payment: date paid, payee, account, token, quantity, daily price, USD, description, how it was placed and why, where the date came from, and a link to the transaction that paid it |
| `quickbooks-journal.csv` | QuickBooks Online, Settings > Import data > Journal entries (Journal No, Journal Date, Account Name, Debits, Credits, Description) |
| `xero-manual-journal-1.csv` | Xero manual journal import (Narration, Date, Description, AccountCode, TaxRate, Amount: debits positive, credits negative), at most 300 rows per file |
| `chart-of-accounts.csv` | the accounts the journals use, to create before importing |
| `monthly-spending.csv` | spending by account and month |
| `balance-check.csv` | opening − paid out + moved in + other money in = closing, per token and place |
| `questions.csv` | the questions for the treasurer, with the facts behind each |
| `about-these-files.txt` | what every file and column means, in plain words |
| `report.json` | everything above in one fingerprinted file, for `verify` |

Each journal entry has two lines that balance to the cent. Tokens without a trusted price stay in `journal.csv` with their quantity and are left out of the QuickBooks and Xero files. Text that people wrote on chain can't run as a spreadsheet formula, because cells starting with `=`, `+`, `-` or `@` get a leading apostrophe.

## How each payment is placed

The first rule that applies wins, and every line keeps its evidence:

1. **Chain facts.** Money sent to the treasury itself or to its own NEAR Intents balance, NEAR wrapped into wNEAR, NEAR staked, storage deposits, Trezu swaps (an `asset-exchange` sent to a 1Click deposit address, with its quote), and tokens sent into a protocol. None of these is spending.
2. **The payee's own-name account.** `x.near` paid by `x.sputnik-dao.near` is the organization's own account.
3. **Words a person wrote** in the proposal, checked in a fixed order: refund, loan, multisig or top-up (own wallets), an exchange name, protocol fee, grant, bounty or prize, salary or honorarium, invoice or services (also `inv 47`), travel or expenses, hosting or software, marketing or events, storage or gas.
4. **The payee.** Another Sputnik DAO, or an account that words already placed, but only when all those earlier placements agree.
5. **Otherwise Suspense** (1999), with the reason. The treasurer is asked about it.

A Trezu payment names its recipient, and on chain the money goes to a 1Click deposit address that forwards it. The named recipient is the payee, and the evidence says so.

## The questions

Each comes from a strict rule, is phrased as a question, and lists its facts:

- **Possible duplicate:** the same payee, token and amount from different proposals within 14 days. Repeats under $100 are ignored.
- **Memo amount mismatch:** the description, or a Trezu bulk list's stated total, gives an amount in the same unit that nothing sent matches.
- **Balance gap:** money left a balance and no proposal Tickmark read explains it.
- **Possibly still owed:** a payment that failed, expired, or stayed open past the voting period, with no later payment that matches.
- **Payee voted:** the payee approved proposals that paid them.
- **Large without description:** $10,000 or more whose proposal says nothing, even if the payee's history placed it.
- **Unnamed payee:** an account with no name (64 hex characters).
- **Unexplained:** Suspense lines, one question per payee.

## Dates, prices and balances

- **Date paid.** Sputnik proposals record only when they were submitted. The payment runs in the transaction whose vote approved the proposal, so Tickmark finds that vote in FastNear's free transaction index. A Trezu bulk payment line is dated by the block its list marks as paid. If neither is found, the submission date is kept and the line says so.
- **Price.** The daily USD price for the UTC day the payment was made, from CoinGecko's free API, committed in [data/prices](data/prices) (`npm run prices:update` refreshes it). Dollar stablecoins are $1. Prices attach only by exact token contract, listed in [core/tokens.ts](core/tokens.ts), because anyone can deploy a token called "USDC". Other tokens show their quantity and no dollar value.
- **Balances.** For each token and place, the opening balance (read at the last block before the first day) minus what the books paid out, plus moves in from the treasury's own balances, plus other money in, equals the closing balance (read at the report's block). "Other money in" (income, donations, swap proceeds) is derived. If it comes out negative beyond a small tolerance, money left in a way no proposal explains, and a question is asked.

## Reports anyone can rebuild

Every run reads the chain at one block. The report records that block, the price snapshot dates and the Tickmark version, and its fingerprint is the SHA-256 of its canonical JSON (sorted keys, no spaces). `verify` rebuilds the books at that block from an archival node and compares fingerprints.

## Close the books by vote *(building)*

Tickmark drafts a normal proposal for the DAO that carries the report's fingerprint. The council approves it with the treasury's own voting rules: no new multisig, no new contract. Anyone can then run `verify` on the report the DAO voted on.

## Private suggestions for Suspense *(building)*

NEAR AI Cloud suggests a category and a question for each Suspense line, running on a hardware-secured (TEE) model. Each reply's signature and the hardware attestation are checked and shown. Suggestions never override rule evidence, and nothing is stored on a server.

## Website *(building)*

All of the above for any treasury, in the browser, with the same downloads.

## What Tickmark reads

| Money moves by | How Tickmark reads it |
| --- | --- |
| Sputnik `Transfer` proposal (NEAR or any NEP-141 token) | `get_proposals` on the DAO |
| Function call `ft_transfer` on a token contract | decoded from the proposal's call arguments |
| NEAR Intents `mt_transfer`, `mt_batch_transfer`, `ft_withdraw` | decoded from the call arguments; `nep141:` asset ids mapped to token contracts |
| Deposits into NEAR Intents (`ft_transfer_call` to `intents.near`) | credited to the account named in the message, or to the treasury when it is empty |
| Trezu bulk payments (`bulkpayment.near`) | NEAR lists via `approve_list`, token lists via `ft_transfer_call` with the list id; each list is read with `view_list` and split per recipient, with its paid status and block |
| NEAR attached to any other call (staking, wrapping, storage) | the attached deposit |

Only money that moved counts as paid: the proposal is `Approved`, and for bulk lists the line is `Paid`. Proposals that failed, expired or are still open are kept and used for questions.

## Known limits

- **Money coming in** is not itemized. The balance check derives its total per token.
- **Cross-chain payments** signed through chain signatures (`v1.signer`) are not decoded. If they move a balance the books touch, they show up as a balance gap.
- **Staked NEAR** is booked when staked; staking rewards are not read.
- **Prices** cover the last 365 days (CoinGecko's free limit). Older payments have no dollar value.
- **Xero:** Xero's own help page could not be read by machine, so the Xero file follows the format two Xero import tools document. It still needs a test import into Xero's demo company.
- **Placements from words** are only as good as the words. "Placed by" and "Why" let a bookkeeper overrule any of them.

## Project layout

```
core/       reading the chain, decoding, dates, prices, accounts, journal, questions, balances, report, CSV
            (no Node-only imports: the website runs the same code)
cli/        the tickmark command and the pipeline it shares with scripts
scripts/    price snapshot refresh, token check, date proof, multi-DAO measurement
data/       committed price snapshot
test/       unit tests with fictional fixtures in real on-chain shapes
```

## Disclosure

- **Other project.** The same author also entered **Ownling**, an AI pet that owns itself (https://github.com/04-John/Ownling). The two projects are independent.
- **AI-written code.** Most of the code was written with Claude Code (Anthropic), directed and reviewed by the author.
- **Libraries.** TypeScript 7.0.2 and @types/node, for type checking only. Runtime code uses only Node.js and browser built-ins.
- **Data sources.**
  - NEAR RPC: https://rpc.mainnet.fastnear.com, with archival reads from https://archival-rpc.mainnet.fastnear.com;
  - FastNear's transaction index (https://tx.main.fastnear.com) for the approving votes;
  - CoinGecko's free API for prices.
- **Test data.** Accounts and memos in the test fixtures are fictional.

## License

MIT, see [LICENSE](LICENSE).
