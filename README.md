# Tickmark

Books and audit questions for any NEAR treasury, read straight from the chain.

Point Tickmark at a Sputnik DAO or Trezu treasury. It lists every payment the treasury made, dates each one by the vote that paid it, values it in US dollars on that day, and places it in a chart of accounts with the reason why. It checks the balances against the chain and lists the questions an auditor would ask the treasurer. It also writes files that QuickBooks, Xero or a spreadsheet can open. Built at NEAR HACKATHON (November 2026).

> **Status: work in progress (day 1 of 4).** Everything under [Try it](#try-it) works today. Sections marked *(building)* are planned and not done yet. This note goes away when they are.

## Why

In the 12 months to 11 November 2026, 92 NEAR DAOs paid out **$99.8M** to other accounts. For **$67.7M (68%)** of it, nothing in the proposal, the chain or the payee's history says what it was for. **$59.4M (59%)** went out on a proposal whose description is empty or a single word like "transfer". Test DAOs, swaps, wrapped NEAR, staking, loans, and moves between a treasury's own accounts are not counted.

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

### The demo treasury (testnet, problems planted on purpose)

`tickmark-demo-toe27k.sputnik-v2.testnet` is our own testnet DAO, built by [scripts/demo-testnet.ts](scripts/demo-testnet.ts) with every account fictional and test NEAR only. It has seven planted problems:
- the same invoice paid twice;
- a description saying 0.5 NEAR for a 0.25 NEAR payment;
- an undescribed payment to an account with no name;
- a council member approving their own honorarium;
- a payment to an account that doesn't exist, which Sputnik still marks Approved;
- a request nobody answered;
- plus one clean invoice.

Its books are committed in [demo/](demo/), and its council approved them by vote. Test NEAR has no value; it is priced like NEAR so the dollar columns are filled.

**Do:**

```sh
node cli/tickmark.ts verify demo/report.json
```

**See:** `closed by vote: proposal #7 is Approved` and `VERIFIED: the report matches the chain.` The books match the chain, and the council approved these exact books. [demo/questions.csv](demo/questions.csv) lists the questions the seven problems raise, starting with `Was invoice 41 paid twice?` and `#5 was approved, but the payment failed on chain and the money came back`.

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
2. **Words a person wrote** in the proposal, checked in a fixed order: refund, loan, multisig or top-up (own wallets), an exchange name, protocol fee, grant, bounty or prize, salary or honorarium, invoice or services (also `inv 47`), travel or expenses, hosting or software, marketing or events, storage or gas.
3. **The payee.** Another Sputnik DAO, or an account that words already placed, but only when all those earlier placements agree.
4. **The payee's own-name account.** When nothing else applies, `x.near` paid by `x.sputnik-dao.near` is treated as the organization's own account. This comes last because a person can own an account named like the DAO.
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

## Close the books by vote

The council approves the books with the treasury's own governance. There's no new multisig and no new contract.

**Do:**

```sh
node cli/tickmark.ts close out/daocubator/report.json --signer <your-account.near>
```

**See:**
- the proposal: an ordinary Sputnik proposal of kind `Vote`, text only, that moves no money;
- whether your account may submit it under the DAO's policy;
- the exact `near` CLI command a council member runs to submit it. Tickmark never signs.

The proposal's description carries `Tickmark Report: sha256:<fingerprint>` and the block it was made at. The council then votes as usual.

**Do:** `node cli/tickmark.ts closings <dao>`
**See:** every close-the-books proposal of that DAO, its status, and how each member voted.

`verify report.json` also shows any proposal in the DAO that carries the report's fingerprint, with its votes. So one command proves both things: the books match the chain, and the council approved these exact books.

## Private suggestions for Suspense

**Do:**

```sh
cp .env.example .env    # then put your NEAR AI Cloud key in it
node cli/tickmark.ts books daocubator.sputnik-dao.near --suggest --notes my-vendors.txt --out out/daocubator
```

**See:** for each payee in Suspense, a suggested account, a confidence, the reason, and the question to ask the treasurer. Below them is a **Verified** list, with each check that passed:

- the model is listed by NEAR AI (`/v1/model/list`) as verifiable, with attestation support;
- the model's and the gateway's attestation were fetched with a fresh random nonce and verified (Intel TDX quote, NVIDIA GPU evidence, measured deployment);
- the request was end-to-end encrypted to the attested model key;
- the reply's signature was checked against the attested signer;
- nothing is stored on a server: Tickmark has none.

How it stays private:
- **Only Suspense is sent.** Lines the rules placed are never sent.
- **Notes stay inside the request.** Your private notes (a vendor list, agreements) travel only inside the encrypted request to the TEE.
- **Kept apart from the books.** Suggestions go to `suggestions.json`, never into the books or `report.json`, because AI output varies between runs and the books must not. A suggestion with an account outside the chart, or for a payee that wasn't sent, is dropped and reported.

Without a key, `--suggest` runs in **practice mode**: nothing is sent anywhere, and the output says it is not verified.

A real run on daocubator, 12 November 2026 (76 seconds, most of it the first secure connection):

```
• taoist.near → Contractors and services (medium): Identical recurring monthly 'dev' payments alongside
  godofnfts.near suggest a second contracted developer, though the name itself proves nothing.
    ask: Is taoist.near a contracted developer receiving the same monthly retainer, and what was the
         purpose of the unlabeled 420 USDC payment?
Verified:
  ✓ z-ai/glm-5.3-flash is listed by NEAR AI as a verifiable TEE model
  ✓ attestation fetched with a fresh nonce (8a1c3506872136ca…, a0d4104b8150b2be…) and verified; TCB UpToDate; GPU verified
  ✓ request end-to-end encrypted to the attested model key
  ✓ reply signed by 5a0210f2442c79355784f9de021985429561da5bacc3a4424b01ac52b7e0caff (provider_tee); signature checked
  ✓ nothing stored on a server: Tickmark has none
```

## Website

The same code runs in the browser. It reads the public NEAR endpoints directly, so there is no server.

**Do:**

```sh
npm run site:build     # compiles core/ and site/app.ts to browser JavaScript (no bundler)
npm run site:serve     # http://localhost:5180
```

Open `http://localhost:5180/?dao=daocubator.sputnik-dao.near`.

**See:**
- the figures, spending by account and month, the balance check, the questions, and the journal with the reason for each line;
- every download from `--out`;
- the close-the-books proposal, with a check that your account may submit it;
- a "Check a report" box that rebuilds any `report.json` from the chain and shows the vote that approved it.

Published at https://04-john.github.io/Tickmark/ by [.github/workflows/pages.yml](.github/workflows/pages.yml). On every push, that workflow runs `npm run check` and builds the site.

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
cli/        the tickmark command, its NEAR AI client, and the Node wrapper around core/pipeline.ts
site/       the website (index.html, styles.css, app.ts); built into site/dist
scripts/    price snapshot refresh, token check, date proof, multi-DAO measurement, site build and preview
data/       committed price snapshot, and the headline measurement (data/measure)
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
