import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Stream } from 'effect';
import { AccountKey } from '@runlith/llm/models/authStatus';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { HarnessAccounts } from '../../providers/contract/service/harness.js';
import { accountFor } from './launch.js';
import { builtinHarness } from '../testing/builtin.js';

const unused = () => Effect.die('this selection does not edit accounts');
const accounts: HarnessAccounts['Service'] = {
  defaultSignedIn: Stream.empty,
  owns: unused,
  launchable: unused,
  launch: (provider, key) =>
    provider === 'external'
      ? Effect.fail(new GateRefusal('provider-not-installed', 'unknown provider', ['install the provider']))
      : Effect.succeed({ account: AccountKey.make(key ?? 'current-default'), directory: '/account/link/', entries: [] }),
  status: unused,
  begin: unused,
  complete: unused,
  cancel: unused,
  rename: unused,
  remove: unused,
};

it.effect('account-less harnesses launch without interpreting the thread marker as a model provider', () =>
  Effect.gen(function* () {
    for (const name of ['cursor', 'gemini'] as const)
      expect(yield* accountFor(accounts, builtinHarness(name), { provider: 'external', account: null })).toBeNull();
  }),
);

it.effect('a pinned session resolves its account instead of a later thread selection or default', () =>
  Effect.gen(function* () {
    const selected = yield* accountFor(
      accounts,
      builtinHarness('claude-code'),
      { provider: 'next', account: 'next' },
      { provider: 'original', key: 'kept' },
    );
    expect(selected).toEqual({ provider: 'original', account: AccountKey.make('kept'), directory: '/account/link/', entries: [] });
  }),
);
