// Words for the report's codes. Tones map to colour meaning: pencil = a person should look, ok = checked on chain,
// warn = inferred, link = the proposal's own words, plain = neutral.
import type { Basis, Section } from '../../../core/classify.ts';
import type { Payee } from '../../../core/payees.ts';
import type { QuestionKind } from '../../../core/questions.ts';
import type { BalanceStatus } from '../../../core/reconcile.ts';
import type { DateSource } from '../../../core/types.ts';

export type Tone = 'pencil' | 'ok' | 'warn' | 'link' | 'plain' | 'ink';

export const KIND: Record<QuestionKind, string> = {
  possible_duplicate: 'Possible duplicate',
  memo_amount_mismatch: 'Amount differs from the description',
  balance_gap: 'Balance gap',
  possibly_still_owed: 'Possibly still owed',
  payee_voted: 'Payee voted on own pay',
  large_without_description: 'Large payment, no description',
  unnamed_payee: 'Unnamed payee',
  unexplained: 'Unexplained',
};

export const BASIS: Record<Basis, [string, Tone]> = {
  chain: ['Chain fact', 'ok'],
  memo: ['Proposal words', 'link'],
  payee_history: ['Payee history', 'warn'],
  account_name: ['Account name', 'warn'],
  none: ['Not placed', 'pencil'],
};

export const DATE_SOURCE: Record<DateSource, [string, Tone]> = {
  approval_vote: ['Dated by vote', 'ok'],
  bulk_paid_block: ['Bulk list paid block', 'ok'],
  submitted: ['Submission date', 'warn'],
};

export const SECTION: Record<Section, [string, Tone]> = {
  expense: ['Spending', 'plain'],
  suspense: ['Not explained yet', 'pencil'],
  balance_sheet: ['Not spending', 'plain'],
};

export const BALANCE: Record<BalanceStatus, [string, Tone]> = {
  ties: ['Ties out', 'ok'],
  received: ['Received from outside', 'link'],
  unexplained_outflow: ['Money left unseen', 'pencil'],
  unreadable: ['Could not be read', 'plain'],
};

export const PAYEE_KIND: Record<Payee['kind'], [string, Tone]> = {
  named: ['Named account', 'plain'],
  unnamed: ['No name (hex)', 'pencil'],
  dao: ['Another DAO', 'link'],
  own_name: ['The DAO’s own name', 'plain'],
};

export const LOCATION: Record<string, string> = { wallet: 'Wallet', intents: 'NEAR Intents', staked: 'Staked' };
