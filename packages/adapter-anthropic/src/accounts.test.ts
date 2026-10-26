import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Result } from 'effect';
import { claudeAccounts } from './accounts';

const status = (body: object) => Effect.result(claudeAccounts.loggedIn({ stdout: JSON.stringify(body), stderr: '', code: 0 }));

it.effect('a subscription login is an account named by its email; an API-key login is refused; a signed-out CLI holds none', () =>
  Effect.gen(function* () {
    expect(yield* status({ loggedIn: true, authMethod: 'claude.ai', email: 'a@b.c', orgName: 'Org' })).toEqual(
      Result.succeed({ label: 'a@b.c' }),
    );
    expect(Result.isFailure(yield* status({ loggedIn: true, authMethod: 'api-key' }))).toBe(true);
    expect(yield* status({ loggedIn: false })).toEqual(Result.succeed(null));
  }),
);
