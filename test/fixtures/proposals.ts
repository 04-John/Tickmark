// Fictional proposals in the exact shapes Sputnik DAO v2 returns on mainnet (accounts and memos are made up).
import type { Proposal } from '../../core/types.ts';

export const DAO = 'acme.sputnik-dao.near';

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64');
/** 2026-03-02T12:00:00Z in nanoseconds. */
const T = '1772452800000000000';

const proposal = (id: number, kind: Proposal['kind'], extra: Partial<Proposal> = {}): Proposal => ({
  id,
  proposer: 'treasurer.near',
  description: `* Title: fixture ${id}`,
  kind,
  status: 'Approved',
  vote_counts: {},
  votes: {},
  submission_time: T,
  ...extra,
});

export const nativeTransfer = proposal(1, { Transfer: { token_id: '', receiver_id: 'designer.near', amount: '133000000000000000000000000', msg: null } }, {
  description: '* Title: Design services for March <br>* Summary: Invoice #12, US$750',
});

export const usdcTransfer = proposal(2, {
  Transfer: { token_id: '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1', receiver_id: 'designer.near', amount: '750000000', msg: null },
});

export const ftTransfer = proposal(3, {
  FunctionCall: {
    receiver_id: 'usdt.tether-token.near',
    actions: [{ method_name: 'ft_transfer', args: b64({ receiver_id: 'dev.near', amount: '1200000000' }), deposit: '1', gas: '30000000000000' }],
  },
});

export const intentsTransfer = proposal(4, {
  FunctionCall: {
    receiver_id: 'intents.near',
    actions: [
      {
        method_name: 'mt_transfer',
        args: b64({ receiver_id: 'contractor.near', token_id: 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1', amount: '2500000000' }),
        deposit: '1',
        gas: '100000000000000',
      },
    ],
  },
});

export const intentsWithdraw = proposal(5, {
  FunctionCall: {
    receiver_id: 'intents.near',
    actions: [
      {
        method_name: 'ft_withdraw',
        args: b64({ token: 'eth.omft.near', receiver_id: 'eth.bridge.near', amount: '500000000000000000', memo: 'WITHDRAW_TO:0xabc' }),
        deposit: '1',
        gas: '100000000000000',
      },
    ],
  },
});

export const bulkPayment = proposal(6, {
  FunctionCall: {
    receiver_id: 'bulkpayment.near',
    actions: [{ method_name: 'approve_list', args: b64({ list_id: 'list-abc' }), deposit: '30000000000000000000000000', gas: '150000000000000' }],
  },
});

export const staking = proposal(7, {
  FunctionCall: {
    receiver_id: 'validator.poolv1.near',
    actions: [{ method_name: 'deposit_and_stake', args: b64({}), deposit: '1000000000000000000000000000', gas: '150000000000000' }],
  },
});

export const swapDeposit = proposal(8, {
  FunctionCall: {
    receiver_id: 'usdt.tether-token.near',
    actions: [{ method_name: 'ft_transfer_call', args: b64({ receiver_id: 'intents.near', amount: '5000000', msg: '' }), deposit: '1', gas: '100000000000000' }],
  },
});

export const changePolicy = proposal(9, { ChangePolicy: { policy: {} } });

export const failedTransfer = proposal(10, { Transfer: { token_id: '', receiver_id: 'designer.near', amount: '1000000000000000000000000', msg: null } }, { status: 'Failed' });

export const vote = proposal(11, 'Vote');

export const batchIntents = proposal(12, {
  FunctionCall: {
    receiver_id: 'intents.near',
    actions: [
      {
        method_name: 'mt_batch_transfer',
        args: b64({ receiver_id: 'ops.near', token_ids: ['nep141:usdt.tether-token.near', 'nep141:wrap.near'], amounts: ['1000000', '2000000000000000000000000'] }),
        deposit: '1',
        gas: '100000000000000',
      },
    ],
  },
});

export const ALL = [nativeTransfer, usdcTransfer, ftTransfer, intentsTransfer, intentsWithdraw, bulkPayment, staking, swapDeposit, changePolicy, failedTransfer, vote, batchIntents];
