// An account that is not a Sputnik DAO gets a plain answer (personal wallet, other contract, or no such account)
// instead of the chain's raw error, and real failures still surface as they are.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchProposals, NotADao, notADao } from '../core/dao.ts';
import { ViewError, type ViewClient } from '../core/rpc.ts';

const failing = (message: string): ViewClient => ({
  view: async (account, method) => {
    throw new ViewError(message, account, method);
  },
});

test('a personal wallet, another contract and a missing account each get their own plain reason', async () => {
  const cases: [string, NotADao['kind']][] = [
    ['wasm execution failed with error: CompilationError(CodeDoesNotExist { account_id: "alice.testnet" })', 'wallet'],
    ['wasm execution failed with error: MethodResolveError(MethodNotFound)', 'contract'],
    ['UNKNOWN_ACCOUNT {"requested_account_id":"nobody.near"}', 'missing'],
  ];
  for (const [message, kind] of cases) {
    await assert.rejects(fetchProposals(failing(message), 'alice.testnet'), (error: unknown) => {
      assert.ok(error instanceof NotADao, message);
      assert.equal(error.kind, kind);
      assert.equal(error.account, 'alice.testnet');
      return true;
    });
  }
});

test('the wallet message says what Tickmark reads, in plain words', () => {
  const e = new NotADao('alice.near', 'wallet');
  assert.match(e.message, /alice\.near is a personal wallet, not a DAO treasury/);
  assert.match(e.message, /Sputnik DAO and Trezu treasuries/);
  assert.match(new NotADao('nobody.near', 'missing').message, /no account called nobody\.near/);
});

test('other failures are not mistaken for "not a DAO"', async () => {
  assert.equal(notADao(new Error('fetch failed'), 'x.near'), null);
  assert.equal(notADao(new ViewError('Smart contract panicked: boom', 'x.near', 'get_last_proposal_id'), 'x.near'), null);
  await assert.rejects(fetchProposals(failing('Smart contract panicked: boom'), 'x.sputnik-dao.near'), (error: unknown) => !(error instanceof NotADao) && error instanceof ViewError);
});
