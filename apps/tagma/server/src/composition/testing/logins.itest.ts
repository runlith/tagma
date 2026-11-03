import { expect } from 'bun:test';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from '@runlith/effect-test';
import { Context, Effect, Fiber, Option, Stream } from 'effect';
import { AccountQuota } from '../../providers/contract/service/quota.js';
import { InstalledHarnesses } from '../../threads/contract/service/harness.js';
import { makeE2eWorld } from './e2eWorld.js';

const ran = (program: string, args: readonly string[]) =>
  new Promise<{ readonly stdout: string; readonly code: number }>((resolve) => {
    execFile(program, args, (error, stdout) => resolve({ stdout, code: error === null ? 0 : Number(error.code ?? 1) }));
  });

it.live('a fresh login world stands only its controlled CLIs, holds a status until answered and counts every start', () =>
  Effect.gen(function* () {
    const served = yield* makeE2eWorld({ logins: { claude: 'held', codex: 'absent' } });
    const installs = Context.get(served.world.runtime.owners, InstalledHarnesses);
    const binary = (rows: Effect.Success<typeof installs.settled>, harness: string) =>
      rows.find((row) => row.harness === harness)?.binary ?? null;
    const first = yield* installs.settled;
    expect(binary(first, 'claude-code')).not.toBeNull();
    expect(binary(first, 'codex')).toBeNull();

    yield* served.logins.started('claude');
    const quota = Context.get(served.world.runtime.owners, AccountQuota);
    const connected = yield* Effect.forkChild(
      Stream.runHead(Stream.filter(quota.changes, (table) => table.some((row) => row.provider === 'claude-code' && row.problem === null))),
    );
    yield* served.logins.answer('claude', 'signed-in');
    expect(Option.isSome(yield* Fiber.join(connected))).toBe(true);
    expect(yield* served.logins.starts('claude')).toContainEqual({
      argv: ['auth', 'status', '--json'],
      cwd: expect.stringContaining('tagma-account-status'),
      variable: null,
      mise: null,
      tty: false,
    });
    const answered = yield* Effect.promise(() => ran(binary(first, 'claude-code')!, ['auth', 'status', '--json']));
    expect(JSON.parse(answered.stdout)).toMatchObject({ loggedIn: true, authMethod: 'claude.ai' });
    expect(JSON.parse(readFileSync(join(served.logins.place('claude'), '.claude.json'), 'utf8'))).toHaveProperty('oauthAccount');

    yield* served.logins.answer('codex', 'signed-out');
    const codex = binary(yield* installs.refresh, 'codex');
    expect(codex).not.toBeNull();
    expect((yield* Effect.promise(() => ran(codex!, ['login', 'status']))).code).toBe(1);
    yield* Effect.promise(() => ran(codex!, ['--model', 'fixture']));
    yield* served.logins.launched('codex');
  }),
);
