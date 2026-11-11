// Read-only NEAR RPC: contract view calls and block headers, with retries. Works in Node and browsers (global fetch).
import { FinalError, throttled, throwIfRetryable, withRetries } from './http.ts';
import { nsToMs, toBase64 } from './units.ts';

export type Network = 'mainnet' | 'testnet';

/** Free public RPC endpoints (https://docs.near.org/api/rpc/providers). They keep about the last two days of state. */
export const DEFAULT_RPC: Record<Network, string> = {
  mainnet: 'https://rpc.mainnet.fastnear.com',
  testnet: 'https://test.rpc.fastnear.com',
};

/** Free archival endpoints: every block since genesis. Used for old block times and for state at an old block. */
export const ARCHIVAL_RPC: Record<Network, string> = {
  mainnet: 'https://archival-rpc.mainnet.fastnear.com',
  testnet: 'https://archival-rpc.testnet.fastnear.com',
};

/** A view call the chain answered with an error (unknown account, missing method, contract panic). Not retried. */
export class ViewError extends FinalError {
  readonly account: string;
  readonly method: string;
  constructor(message: string, account: string, method: string) {
    super(`${account}.${method}: ${message}`);
    this.name = 'ViewError';
    this.account = account;
    this.method = method;
  }
}

/** The subset of the RPC client that the rest of Tickmark needs; tests pass a fake. */
export interface ViewClient {
  view<T>(account: string, method: string, args?: unknown): Promise<T>;
}

export type BlockInfo = { height: number; hash: string; timestampMs: number };

/** Reads block headers; tests pass a fake. */
export interface BlockClient {
  block(ref?: number | 'final'): Promise<BlockInfo>;
}

export type RpcOptions = {
  network?: Network;
  /** Overrides the endpoint for the network. */
  url?: string;
  /** Read contract state as of this block height instead of the latest final block. */
  blockId?: number;
  /** Attempts for network errors, timeouts, 429 and 5xx. */
  attempts?: number;
  /** First wait between attempts; doubles each time. */
  retryDelayMs?: number;
  fetchImpl?: typeof fetch;
};

type RpcAnswer<T> = { error?: { name?: string; cause?: { name?: string }; message?: string; data?: unknown }; result?: T };

export class Rpc implements ViewClient, BlockClient {
  readonly url: string;
  readonly network: Network;
  readonly blockId: number | undefined;
  private readonly options: RpcOptions;
  private readonly fetchImpl: typeof fetch;

  constructor(options: RpcOptions = {}) {
    this.options = options;
    this.network = options.network ?? 'mainnet';
    this.url = options.url ?? DEFAULT_RPC[this.network];
    this.blockId = options.blockId;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  /** The same endpoint, reading state as of `blockId`. */
  at(blockId: number): Rpc {
    return new Rpc({ ...this.options, url: this.url, blockId });
  }

  /** One JSON-RPC call. Errors from the chain are thrown as FinalError; network trouble is retried. */
  async call<T>(method: string, params: unknown, label: string = method): Promise<T> {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 'tickmark', method, params });
    return withRetries(
      label,
      this.options.attempts ?? 6,
      () =>
        throttled(this.url, async () => {
          const res = await this.fetchImpl(this.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
          throwIfRetryable(res);
          const json = (await res.json()) as RpcAnswer<T>;
          if (json.error) {
            const cause = json.error.cause?.name ?? json.error.name ?? 'RPC error';
            if (cause === 'TIMEOUT_ERROR' || cause === 'INTERNAL_ERROR') throw new Error(cause);
            throw new FinalError(`${cause} ${JSON.stringify(json.error.data ?? json.error.message ?? '')}`);
          }
          if (json.result === undefined) throw new FinalError('empty result');
          return json.result;
        }),
      (error) => error instanceof FinalError,
      this.options.retryDelayMs,
    );
  }

  async view<T>(account: string, method: string, args: unknown = {}): Promise<T> {
    const at = this.blockId === undefined ? { finality: 'final' } : { block_id: this.blockId };
    let result: { result?: number[]; error?: string };
    try {
      result = await this.call('query', {
        request_type: 'call_function',
        ...at,
        account_id: account,
        method_name: method,
        args_base64: toBase64(JSON.stringify(args)),
      }, `${account}.${method}`);
    } catch (error) {
      if (error instanceof FinalError) throw new ViewError(error.message, account, method);
      throw error;
    }
    if (result.error) throw new ViewError(result.error, account, method);
    if (!result.result) throw new ViewError('empty result', account, method);
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(result.result))) as T;
  }

  /** An account's native NEAR balance (yoctoNEAR strings) at the pinned block, or the latest final block. */
  async viewAccount(accountId: string): Promise<{ amount: string; locked: string }> {
    const at = this.blockId === undefined ? { finality: 'final' } : { block_id: this.blockId };
    try {
      return await this.call<{ amount: string; locked: string }>('query', { request_type: 'view_account', ...at, account_id: accountId }, `view_account ${accountId}`);
    } catch (error) {
      if (error instanceof FinalError) throw new ViewError(error.message, accountId, 'view_account');
      throw error;
    }
  }

  /** A block's height, hash and time. Blocks older than about two days need an archival endpoint. */
  async block(ref: number | 'final' = 'final'): Promise<BlockInfo> {
    const params = ref === 'final' ? { finality: 'final' } : { block_id: ref };
    const { header } = await this.call<{ header: { height: number; hash: string; timestamp_nanosec: string } }>('block', params, `block ${ref}`);
    return { height: header.height, hash: header.hash, timestampMs: nsToMs(header.timestamp_nanosec) };
  }
}
