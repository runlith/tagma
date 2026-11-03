import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { claudeAccounts } from './accounts';

const status = (body: object) => claudeAccounts.loggedIn({ stdout: JSON.stringify(body), stderr: '', code: 0 });

it.effect('the CLI status distinguishes a subscription, other methods, sign-out and an unreadable answer', () =>
  Effect.gen(function* () {
    expect(yield* status({ loggedIn: true, authMethod: 'claude.ai', email: 'a@b.c', orgName: 'Org' })).toEqual({
      kind: 'signed-in',
      label: 'a@b.c',
    });
    expect(yield* status({ loggedIn: true, authMethod: 'api-key' })).toEqual({ kind: 'unsupported-method', method: 'api-key' });
    expect(yield* status({ loggedIn: false })).toEqual({ kind: 'signed-out' });
    expect(yield* claudeAccounts.loggedIn({ stdout: 'not json', stderr: '', code: 1 })).toMatchObject({ kind: 'unreadable' });
    expect(
      yield* claudeAccounts.loggedIn({ stdout: '{"loggedIn":true,"authMethod":"claude.ai"}', stderr: 'failed', code: 1 }),
    ).toMatchObject({
      kind: 'unreadable',
    });
  }),
);
