// Attach token metadata and a USD value to each movement.
import type { PriceBook } from './prices.ts';
import type { TokenBook } from './tokens.ts';
import type { Movement } from './types.ts';
import { formatUnits, toNumber } from './units.ts';

export type ValuedMovement = Movement & {
  symbol: string;
  decimals: number;
  /** Exact decimal amount, e.g. "45000" NEAR. */
  quantity: string;
  /** Null when the token has no trusted price or the date is outside the price snapshot. */
  usd: number | null;
  /** UTC date of the price used. */
  priceDate: string | null;
  /** USD for one unit on priceDate. */
  unitPrice: number | null;
};

/** Values each movement at the price on the day it was proposed. */
export async function valueMovements(movements: Movement[], tokens: TokenBook, prices: PriceBook): Promise<ValuedMovement[]> {
  return Promise.all(
    movements.map(async (m) => {
      const token = await tokens.get(m.token);
      const quote = token.price ? prices.quote(token.price, m.proposedAt) : null;
      const usd = quote ? Math.round(toNumber(m.amount, token.decimals) * quote.usd * 100) / 100 : null;
      return {
        ...m,
        symbol: token.symbol,
        decimals: token.decimals,
        quantity: formatUnits(m.amount, token.decimals),
        usd,
        priceDate: quote?.date ?? null,
        unitPrice: quote?.usd ?? null,
      };
    }),
  );
}
