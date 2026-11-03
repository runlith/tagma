import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { accounts } from './accounts';
import { accountEnvironment } from './environment';

test('native defaults retain HOME and XDG while an explicit profile redirects both and cannot inherit another database', () => {
  const environment = (directory: string | null) => {
    const values: Record<string, string | undefined> = { HOME: '/native', XDG_DATA_HOME: '/native-data', OPENCODE_DB: '/foreign.db' };
    for (const entry of accountEnvironment(directory)) values[entry.name] = entry._tag === 'Set' ? entry.value : undefined;
    return values;
  };
  const native = environment(null);
  expect(native.HOME).toBe('/native');
  expect(native.XDG_DATA_HOME).toBe('/native-data');
  expect(native.OPENCODE_DB).toBeUndefined();
  const profile = environment('/profile');
  expect(profile.HOME).toBe('/profile');
  expect(profile.XDG_DATA_HOME).toBe(join('/profile', '.local', 'share'));
  expect(profile.OPENCODE_DB).toBeUndefined();
});

const auth = accounts('opencode');
const read = (body: unknown) => auth.loggedIn({ stdout: JSON.stringify(body), stderr: '', code: 0 });

it.effect('official status identifies connected upstreams and preserves signed-out, expired and malformed outcomes', () =>
  Effect.gen(function* () {
    expect(
      yield* read([
        {
          id: 'github-copilot',
          name: 'GitHub Copilot',
          connections: [{ type: 'credential', id: 'credential-1', label: 'octocat', method: 'oauth' }],
        },
      ]),
    ).toEqual({ kind: 'signed-in', label: 'GitHub Copilot · octocat' });
    expect(yield* read([])).toEqual({ kind: 'signed-out' });
    const expired = yield* read([
      {
        id: 'github-copilot',
        name: 'GitHub Copilot',
        connections: [
          {
            type: 'credential',
            id: 'credential-1',
            label: 'octocat',
            method: 'oauth',
            status: { status: 'needs_auth', message: 'Sign in again' },
          },
        ],
      },
    ]);
    expect(expired).toMatchObject({ kind: 'unreadable', reason: expect.stringContaining('Sign in again') });
    expect(yield* read({ tokens: [] })).toMatchObject({ kind: 'unreadable' });
    const failed = yield* auth.loggedIn({ stdout: '[]', stderr: 'database unavailable', code: 1 });
    expect(failed).toMatchObject({ kind: 'unreadable', reason: expect.stringContaining('database unavailable') });
  }),
);
