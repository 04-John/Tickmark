// Shapes of what Sputnik DAO v2 returns, and of the money movements Tickmark derives from it.

export type ProposalStatus = 'InProgress' | 'Approved' | 'Rejected' | 'Removed' | 'Expired' | 'Moved' | 'Failed';

export type FunctionCallAction = { method_name: string; args: string; deposit: string; gas: string };

export type TransferKind = { Transfer: { token_id: string; receiver_id: string; amount: string; msg?: string | null } };
export type FunctionCallKind = { FunctionCall: { receiver_id: string; actions: FunctionCallAction[] } };

/** Sputnik's ProposalKind: a bare string for unit variants ("Vote"), otherwise a one-key object. */
export type ProposalKind = string | TransferKind | FunctionCallKind | Record<string, unknown>;

/** One entry of `get_proposals` on a Sputnik DAO v2 contract (Trezu treasuries use the same contract). */
export type Proposal = {
  id: number;
  proposer: string;
  description: string;
  kind: ProposalKind;
  status: ProposalStatus;
  vote_counts: Record<string, unknown>;
  votes: Record<string, string>;
  /** Nanoseconds since the Unix epoch, as a decimal string. */
  submission_time: string;
};

/** How a movement was made, which decides how it is decoded and later classified. */
export type Via =
  | 'transfer' // Sputnik Transfer proposal (NEAR or a NEP-141 token)
  | 'ft_transfer' // FunctionCall ft_transfer on a token contract
  | 'ft_transfer_call' // FunctionCall ft_transfer_call: tokens sent into a protocol (deposit, swap, list funding)
  | 'intents_transfer' // NEAR Intents mt_transfer / mt_batch_transfer
  | 'intents_withdraw' // NEAR Intents ft_withdraw
  | 'bulk_payment' // Trezu bulk payment list, one movement per recipient
  | 'attached_deposit'; // NEAR attached to any other function call (staking, wrapping, storage...)

export type DateSource = 'approval_vote' | 'bulk_paid_block' | 'submitted';

/** The date a movement is booked on: when it was paid if known, otherwise when it was proposed. */
export function bookingTime(m: Pick<Movement, 'paidAt' | 'proposedAt'>): number {
  return m.paidAt ?? m.proposedAt;
}

/** One amount of one asset leaving (or proposed to leave) a treasury. */
export type Movement = {
  dao: string;
  proposalId: number;
  /** Position inside the proposal: 0 for most, one per action or recipient otherwise. */
  line: number;
  status: ProposalStatus;
  /** True only when the money moved: the proposal was Approved and, for bulk lists, the line was Paid. */
  executed: boolean;
  /** When the proposal was submitted, in Unix milliseconds. */
  proposedAt: number;
  /** `near` for native NEAR, otherwise the NEP-141 token contract (or an Intents asset id). */
  token: string;
  to: string;
  /** Raw integer amount in the token's smallest unit. */
  amount: string;
  via: Via;
  /** Contract method for function calls. */
  method?: string;
  /** The proposal description exactly as the DAO wrote it. */
  memo: string;
  proposer: string;
  /** Trezu bulk payment list id, set until the list is expanded into per-recipient lines. */
  bulkListId?: string;
  /** Block in which a Trezu bulk payment line was marked Paid (from the list contract). */
  bulkPaidBlock?: number;
  /** On an expanded bulk line: the list it came from, so anyone can re-read it with view_list. */
  bulkList?: string;
  /** When the money moved, in Unix milliseconds. Set by datePayments(); falls back to proposedAt when unknown. */
  paidAt?: number;
  /** The block whose time is paidAt. */
  paidAtBlock?: number;
  /** Where paidAt came from: the approving vote, the bulk line's paid block, or nothing found (submission date used). */
  dateSource?: DateSource;
  /** Hash of the transaction that approved the proposal and so executed the payment. */
  approvalTx?: string;
  /** Why something could not be decoded fully. */
  note?: string;
};
