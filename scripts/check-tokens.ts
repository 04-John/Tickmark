// Check every entry of KNOWN_TOKENS against the token contract's own ft_metadata on mainnet.
// Usage: node scripts/check-tokens.ts   (exits 1 on any mismatch)
import { Rpc } from '../core/rpc.ts';
import { KNOWN_TOKENS } from '../core/tokens.ts';

const rpc = new Rpc({ network: 'mainnet' });
let bad = 0;
for (const token of Object.values(KNOWN_TOKENS)) {
  if (token.id === 'near') continue;
  try {
    const meta = await rpc.view<{ symbol: string; decimals: number }>(token.id, 'ft_metadata');
    const ok = meta.decimals === token.decimals;
    if (!ok) bad++;
    console.log(`${ok ? 'ok  ' : 'BAD '} ${token.id}: chain says ${meta.symbol}/${meta.decimals}, list says ${token.symbol}/${token.decimals}`);
  } catch (error) {
    bad++;
    console.log(`ERR  ${token.id}: ${(error as Error).message}`);
  }
}
process.exit(bad ? 1 : 0);
