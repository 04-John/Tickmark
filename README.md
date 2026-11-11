# Tickmark

Books and audit questions for any NEAR treasury, read straight from the chain.

Point Tickmark at a Sputnik DAO or Trezu treasury and it lists every payment the treasury made, in every token, valued in US dollars on the day it moved. Built at NEAR HACKATHON (November 2026).

> **Status: work in progress (day 1 of 4).** What works today is under [Try it](#try-it). Sections marked *(building)* are planned and not done yet. This note goes away when they are.

## Who it's for

The bookkeeper or treasurer of a team that pays people from a NEAR DAO. Today they rebuild the books by hand from a block explorer, one proposal at a time, guessing what memo-less payments were for. Tickmark does the reading, the decoding and the dollar values, and leaves them only the questions a person has to answer.

## Try it

Needs Node.js 24 or newer. No keys, no wallet: everything is read from public mainnet data.

```sh
npm ci
npm run check          # type check + unit tests, no network needed
```

**Do:** list a treasury's payments for the last 12 months:

```sh
node cli/tickmark.ts scan daocubator.sputnik-dao.near --lines
```

**See:** proposal counts by kind, money movements, totals by token with USD values, and one line per payment. Trezu bulk payments appear as one line per recipient (for example a 2,700 USDC.e list paid to three people shows as 3 × 900 USDC.e), not as one payment to the bulk payment contract.

Options: `--since YYYY-MM-DD`, `--network testnet`, `--json out.json` (every movement with its price and source fields).

## What Tickmark reads

| Money moves by | How Tickmark reads it |
| --- | --- |
| Sputnik `Transfer` proposal (NEAR or any NEP-141 token) | `get_proposals` on the DAO |
| Function call `ft_transfer` on a token contract | decoded from the proposal's call arguments |
| NEAR Intents `mt_transfer`, `mt_batch_transfer`, `ft_withdraw` on `intents.near` | decoded from the call arguments; `nep141:` asset ids mapped to token contracts |
| Trezu bulk payments (`bulkpayment.near`) | NEAR lists via `approve_list`, token lists via `ft_transfer_call` with the list id; each list is read with `view_list` and split per recipient, with its paid status |
| NEAR attached to any other call (staking, wrapping, storage) | the attached deposit |
| Tokens sent into a protocol with `ft_transfer_call` | recorded with the receiving contract, to be classified |

Only executed money counts as paid: the proposal is `Approved` and, for bulk lists, the line is `Paid`. Proposals that failed, expired or are still open are kept and shown separately.

## Dollar values

- **Daily prices** come from CoinGecko's free API and are committed in [data/prices](data/prices). Refresh them with `npm run prices:update`. The free API covers the last 365 days only.
- **Which price is used:** each payment uses the price for the UTC day it was made, never the next day's.
- **Tokens with a price:** NEAR, wNEAR, ETH, BTC, ZEC, SOL and AURORA, plus dollar stablecoins valued at $1. These are listed by exact contract in [core/tokens.ts](core/tokens.ts), and `node scripts/check-tokens.ts` checks every entry against the chain.
- **Symbols are never trusted.** Anyone can deploy a token that calls itself "USDC". Any other token is shown with its amount and no dollar value.

## Coming next *(building)*

- Each payment placed in a chart of accounts (contractors, grants, payroll, liquidity, staking, transfers between the treasury's own accounts). Each placement says which evidence it used, and anything unclear goes to a suspense account.
- A double-entry journal, a monthly profit-and-loss statement, and treasury balances checked against the chain.
- Exports a bookkeeper can import: generic CSV, QuickBooks Online journal entries and Xero manual journals.
- Audit questions:
  - the same payee paid the same amount twice;
  - a failed payment that was paid again;
  - a memo amount that differs from the amount sent;
  - a proposal left open past its voting period;
  - a large payment with no memo;
  - payees without a named account.
- Private AI on NEAR AI Cloud suggests a category and a question for the treasurer for each suspense item. Each reply is signed by the hardware-secured model, and the signature is checked.
- Closing the books by vote: Tickmark drafts a normal DAO proposal that carries the report's fingerprint, and the council approves it with the treasury's own voting rules.
- A website that does all of this for any treasury.

## Known limits

- **Payment dates.** The date shown is when the proposal was submitted. Most payments execute within the DAO's voting period, but recording the exact execution date is still being built.
- **Cross-chain payments.** Payments signed through chain signatures (`v1.signer`) are not decoded yet.

## Project layout

```
core/       chain reading, decoding, tokens, prices (runs in Node and browsers)
cli/        the tickmark command
scripts/    price snapshot refresh, token list check
data/       committed price snapshot
test/       unit tests with fictional fixtures in real on-chain shapes
```

## Disclosure

- **Other project.** The same author also entered **Ownling**, an AI pet that owns itself (https://github.com/04-John/Ownling). The two projects are independent.
- **AI-written code.** Most of the code was written with Claude Code (Anthropic), directed and reviewed by the author.
- **Libraries.** TypeScript 7.0.2 and @types/node, for type checking only. Runtime code uses only Node.js and browser built-ins.
- **Data sources.**
  - NEAR mainnet RPC (https://rpc.mainnet.fastnear.com) for all chain data;
  - CoinGecko's free API for prices.
- **Test data.** Accounts and memos in the test fixtures are fictional.

## License

MIT, see [LICENSE](LICENSE).
