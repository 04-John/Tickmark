// Read-only NEAR RPC: contract view calls with retries. Works in Node and browsers (global fetch).
import { toBase64 } from './units.ts';

export type Network = 'mainnet' | 'testnet';

/** Free public RPC endpoints (https://docs.near.org/api/rpc/providers). */
export const DEFAULT_RPC: Record<Network, string> = {
  mainnet: 'https://rpc.mainnet.fastnear.com',
  testnet: 'https://test.rpc.fastnear.com',
};

/** A view call the chain answered with an error (unknown account, missing method, contract panic). Not retried. */
export class ViewError extends Error {
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

export type RpcOptions = {
  network?: Network;
  /** Overrides the endpoint for the network. */
  url?: string;
  /** Attempts for network errors, timeouts, 429 and 5xx. */
  attempts?: number;
  fetchImpl?: typeof fetch;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class Rpc implements ViewClient {
  readonly url: string;
  readonly network: Network;
  readonly attempts: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: RpcOptions = {}) {
    this.network = options.network ?? 'mainnet';
    this.url = options.url ?? DEFAULT_RPC[this.network];
    this.attempts = options.attempts ?? 5;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  async view<T>(account: string, method: string, args: unknown = {}): Promise<T> {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 'tickmark',
      method: 'query',
      params: {
        request_type: 'call_function',
        finality: 'final',
        account_id: account,
        method_name: method,
        args_base64: toBase64(JSON.stringify(args)),
      },
    });
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.attempts; attempt++) {
      try {
        const res = await this.fetchImpl(this.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
        if (res.status === 408 || res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as {
          error?: { name?: string; cause?: { name?: string }; message?: string; data?: unknown };
          result?: { result?: number[]; error?: string };
        };
        if (json.error) {
          const cause = json.error.cause?.name ?? json.error.name ?? 'RPC error';
          if (cause === 'TIMEOUT_ERROR' || cause === 'INTERNAL_ERROR') throw new Error(cause);
          throw new ViewError(`${cause} ${JSON.stringify(json.error.data ?? json.error.message ?? '')}`, account, method);
        }
        if (json.result?.error) throw new ViewError(json.result.error, account, method);
        if (!json.result?.result) throw new ViewError('empty result', account, method);
        return JSON.parse(new TextDecoder().decode(Uint8Array.from(json.result.result))) as T;
      } catch (error) {
        if (error instanceof ViewError) throw error;
        lastError = error;
        if (attempt < this.attempts) await sleep(400 * 2 ** (attempt - 1));
      }
    }
    throw new Error(`${account}.${method}: RPC failed after ${this.attempts} attempts: ${String(lastError)}`);
  }
}
