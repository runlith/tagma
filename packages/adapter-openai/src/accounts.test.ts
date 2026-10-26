import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Result } from 'effect';
import { codexAccounts } from './accounts';

const status = (stderr: string, code: number) => Effect.result(codexAccounts.loggedIn({ stdout: '', stderr, code }));

it.effect('a ChatGPT login is an account; an API-key login is refused; a signed-out CLI holds none', () =>
  Effect.gen(function* () {
    expect(yield* status('Logged in using ChatGPT', 0)).toEqual(Result.succeed({ label: 'ChatGPT' }));
    expect(Result.isFailure(yield* status('Logged in using an API key - sk-***', 0))).toBe(true);
    expect(yield* status('Not logged in', 1)).toEqual(Result.succeed(null));
  }),
);
