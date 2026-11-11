// Turn Sputnik DAO proposals into money movements. Pure: no network. Trezu bulk lists are expanded in dao.ts.
import type { FunctionCallKind, Movement, Proposal, TransferKind, Via } from './types.ts';
import { nsToMs, parseBase64Json } from './units.ts';

export const INTENTS_CONTRACT = 'intents.near';
/** Trezu's bulk payment contract: `approve_list` releases a stored list of payments. */
export const BULK_PAYMENT_CONTRACTS = new Set(['bulkpayment.near', 'bulkpayment.testnet']);

export function isTransfer(kind: Proposal['kind']): kind is TransferKind {
  return typeof kind === 'object' && kind !== null && 'Transfer' in kind;
}

export function isFunctionCall(kind: Proposal['kind']): kind is FunctionCallKind {
  return typeof kind === 'object' && kind !== null && 'FunctionCall' in kind;
}

/** The name of a proposal kind, e.g. "Transfer", "FunctionCall", "ChangePolicy", "Vote". */
export function kindName(kind: Proposal['kind']): string {
  if (typeof kind === 'string') return kind;
  return Object.keys(kind)[0] ?? 'Unknown';
}

/** NEAR Intents names assets `nep141:<contract>`; plain NEP-141 contracts are used as they are. */
export function normalizeToken(id: string | null | undefined): string {
  if (!id) return 'near';
  return id.startsWith('nep141:') ? id.slice('nep141:'.length) : id;
}

/** NEAR account id rules (https://nomicon.io/DataStructures/Account): 2-64 chars, lowercase parts joined by . - _ */
const ACCOUNT_ID = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

export function isAccountId(value: string): boolean {
  return ACCOUNT_ID.test(value);
}

/**
 * Whose NEAR Intents balance an ft_transfer_call deposit credits: the account in the message
 * (a plain account id, or JSON with receiver_id), or the sender when the message is empty or unreadable.
 */
export function intentsDepositOwner(msg: unknown, sender: string): string {
  if (typeof msg !== 'string' || msg.trim() === '') return sender;
  const text = msg.trim();
  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text) as { receiver_id?: unknown };
      return typeof parsed.receiver_id === 'string' && isAccountId(parsed.receiver_id) ? parsed.receiver_id : sender;
    } catch {
      return sender;
    }
  }
  return isAccountId(text) ? text : sender;
}

type Args = Record<string, unknown>;
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);

/** Every movement of value a proposal makes (or would make, if it is not executed). */
export function decodeProposal(dao: string, p: Proposal): Movement[] {
  const base = {
    dao,
    proposalId: p.id,
    status: p.status,
    executed: p.status === 'Approved',
    proposedAt: nsToMs(p.submission_time),
    memo: (p.description ?? '').trim(),
    proposer: p.proposer,
  };
  const out: Movement[] = [];
  const push = (m: Omit<Movement, keyof typeof base | 'line'>) => out.push({ ...base, line: out.length, ...m });

  if (isTransfer(p.kind)) {
    const t = p.kind.Transfer;
    push({ token: normalizeToken(t.token_id), to: t.receiver_id, amount: t.amount, via: 'transfer' });
    return out;
  }
  if (!isFunctionCall(p.kind)) return out;

  const { receiver_id: contract, actions } = p.kind.FunctionCall;
  for (const action of actions) {
    const method = action.method_name;
    const parsed = parseBase64Json(action.args);
    const args: Args = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Args) : {};
    const deposit = BigInt(action.deposit || '0');

    if (contract === INTENTS_CONTRACT && method === 'mt_transfer' && str(args.receiver_id) && str(args.amount)) {
      push({ token: normalizeToken(str(args.token_id)), to: str(args.receiver_id)!, amount: str(args.amount)!, via: 'intents_transfer', method });
    } else if (contract === INTENTS_CONTRACT && method === 'mt_batch_transfer' && Array.isArray(args.token_ids) && Array.isArray(args.amounts)) {
      args.token_ids.forEach((tokenId, i) => {
        const amount = (args.amounts as unknown[])[i];
        if (typeof tokenId === 'string' && typeof amount === 'string' && str(args.receiver_id)) {
          push({ token: normalizeToken(tokenId), to: str(args.receiver_id)!, amount, via: 'intents_transfer', method });
        }
      });
    } else if (contract === INTENTS_CONTRACT && method === 'ft_withdraw' && str(args.receiver_id) && str(args.amount)) {
      push({ token: normalizeToken(str(args.token)), to: str(args.receiver_id)!, amount: str(args.amount)!, via: 'intents_withdraw', method });
    } else if (BULK_PAYMENT_CONTRACTS.has(contract) && method === 'approve_list' && str(args.list_id)) {
      // NEAR list: placeholder until expandBulkPayments() reads the stored list; the deposit is the list total.
      push({ token: 'near', to: contract, amount: deposit.toString(), via: 'bulk_payment', method, bulkListId: str(args.list_id)! });
    } else if (method === 'ft_transfer_call' && BULK_PAYMENT_CONTRACTS.has(str(args.receiver_id) ?? '') && str(args.msg) && str(args.amount)) {
      // Token list: funded and released in one call, with the list id as the message.
      push({ token: contract, to: str(args.receiver_id)!, amount: str(args.amount)!, via: 'bulk_payment', method, bulkListId: str(args.msg)! });
    } else if (contract === INTENTS_CONTRACT && method === 'mt_transfer_call' && BULK_PAYMENT_CONTRACTS.has(str(args.receiver_id) ?? '') && str(args.msg) && str(args.amount)) {
      // Token list funded from the DAO's NEAR Intents balance.
      push({ token: normalizeToken(str(args.token_id)), to: str(args.receiver_id)!, amount: str(args.amount)!, via: 'bulk_payment', method, bulkListId: str(args.msg)! });
    } else if (method === 'ft_transfer_call' && str(args.receiver_id) === INTENTS_CONTRACT && str(args.amount)) {
      // A deposit into NEAR Intents is credited to the account named in the message, or to the sender when it is empty.
      push({ token: contract, to: intentsDepositOwner(args.msg, dao), amount: str(args.amount)!, via: 'intents_deposit', method });
    } else if ((method === 'ft_transfer' || method === 'ft_transfer_call') && str(args.receiver_id) && str(args.amount)) {
      const via: Via = method === 'ft_transfer' ? 'ft_transfer' : 'ft_transfer_call';
      push({ token: contract, to: str(args.receiver_id)!, amount: str(args.amount)!, via, method });
    } else if (deposit > 1n) {
      // 1 yoctoNEAR is the security deposit many calls require, not a payment.
      push({ token: 'near', to: contract, amount: deposit.toString(), via: 'attached_deposit', method });
    }
  }
  return out;
}
