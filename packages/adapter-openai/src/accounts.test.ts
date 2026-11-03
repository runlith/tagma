import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { codexAccounts } from './accounts';

const status = (stderr: string, code: number) => codexAccounts.loggedIn({ stdout: '', stderr, code });

it.effect('the CLI status distinguishes ChatGPT, other methods, sign-out and an unreadable answer', () =>
  Effect.gen(function* () {
    expect(yield* status('Logged in using ChatGPT', 0)).toEqual({ kind: 'signed-in', label: 'ChatGPT' });
    expect(yield* status('Logged in using an API key - sk-***', 0)).toEqual({ kind: 'unsupported-method', method: 'an API key' });
    expect(yield* status('API key configured - sk-***\nAuthentication is checked when you send a request.', 0)).toEqual({
      kind: 'unsupported-method',
      method: 'API key',
    });
    expect(yield* status('Not logged in', 1)).toEqual({ kind: 'signed-out' });
    expect(yield* status('status failed', 1)).toMatchObject({ kind: 'unreadable' });
    expect(yield* status('Logged in using ChatGPT', 1)).toMatchObject({ kind: 'unreadable' });
  }),
);
