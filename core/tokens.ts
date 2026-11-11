// Token metadata and which tokens Tickmark can price.
//
// Prices are only ever assigned by exact contract id from the list below. Symbols are never trusted:
// anyone can deploy a token that calls itself "USDC".
import type { ViewClient } from './rpc.ts';

/** Price series Tickmark knows; `usd` means a dollar stablecoin valued at $1. */
export type PriceKey = 'usd' | 'near' | 'eth' | 'btc' | 'zec' | 'sol' | 'aurora';

export type TokenInfo = { id: string; symbol: string; decimals: number; price: PriceKey | null };

/** Verified against `ft_metadata` on mainnet by scripts/check-tokens.ts. */
export const KNOWN_TOKENS: Record<string, TokenInfo> = Object.fromEntries(
  (
    [
      ['near', 'NEAR', 24, 'near'],
      ['wrap.near', 'wNEAR', 24, 'near'],
      ['17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1', 'USDC', 6, 'usd'],
      ['usdt.tether-token.near', 'USDt', 6, 'usd'],
      ['a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.factory.bridge.near', 'USDC.e', 6, 'usd'],
      ['dac17f958d2ee523a2206206994597c13d831ec7.factory.bridge.near', 'USDT.e', 6, 'usd'],
      ['6b175474e89094c44da98b954eedeac495271d0f.factory.bridge.near', 'DAI', 18, 'usd'],
      ['853d955acef822db058eb8505911ed77f175b99e.factory.bridge.near', 'FRAX', 18, 'usd'],
      ['eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near', 'USDC (Ethereum)', 6, 'usd'],
      ['eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near', 'USDT (Ethereum)', 6, 'usd'],
      ['arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near', 'USDC (Arbitrum)', 6, 'usd'],
      ['base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near', 'USDC (Base)', 6, 'usd'],
      ['eth.omft.near', 'ETH', 18, 'eth'],
      ['btc.omft.near', 'BTC', 8, 'btc'],
      ['zec.omft.near', 'ZEC', 8, 'zec'],
      ['sol.omft.near', 'SOL', 9, 'sol'],
      ['aaaaaa20d9e0e2461697782ef11675f668207961.factory.bridge.near', 'AURORA', 18, 'aurora'],
    ] as const
  ).map(([id, symbol, decimals, price]) => [id, { id, symbol, decimals, price }]),
);

type FtMetadata = { symbol?: string; decimals?: number };

/** Looks tokens up once per run: the known list first, then the token contract's own `ft_metadata`. */
export class TokenBook {
  private readonly rpc: ViewClient;
  private readonly cache = new Map<string, Promise<TokenInfo>>();

  constructor(rpc: ViewClient) {
    this.rpc = rpc;
  }

  get(id: string): Promise<TokenInfo> {
    let found = this.cache.get(id);
    if (!found) {
      found = this.lookup(id);
      this.cache.set(id, found);
    }
    return found;
  }

  private async lookup(id: string): Promise<TokenInfo> {
    const known = KNOWN_TOKENS[id];
    if (known) return known;
    try {
      const meta = await this.rpc.view<FtMetadata>(id, 'ft_metadata');
      if (typeof meta.decimals === 'number') return { id, symbol: meta.symbol || id, decimals: meta.decimals, price: null };
    } catch {
      // Not a NEP-141 contract (or an Intents-only asset id); fall through.
    }
    return { id, symbol: id, decimals: 0, price: null };
  }
}
