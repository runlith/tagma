import { expect } from 'bun:test';
import { Effect, Stream } from 'effect';
import { it } from '@runlith/effect-test';
import type { Terminals, TerminalStart } from '../../executions/contract/service/terminals.js';
import type { HarnessProgram, InstalledHarnesses } from '../../threads/contract/service/harness.js';
import { harnessTerminals } from './programs.js';

const unused = () => Effect.die('not reached');
const recording = () => {
  const started: TerminalStart[] = [];
  const terminals = {
    start: (request: TerminalStart) => Effect.sync(() => (started.push(request), { _tag: 'Refused' }) as never),
  } as unknown as Terminals['Service'];
  return { started, terminals };
};
const installsOf = (programs: Record<string, HarnessProgram>): InstalledHarnesses['Service'] => ({
  read: unused(),
  settled: unused(),
  refresh: unused(),
  program: (binary) => Effect.succeed(programs[binary] ?? null),
  locate: (binary) => Effect.succeed(programs[binary] ?? null),
  availability: unused,
  changes: Stream.empty,
});

const request = (program: string, args: readonly string[], environment?: TerminalStart['environment']): TerminalStart =>
  ({ program, args, environment }) as TerminalStart;

it.effect('a harness program starts at the path it was found at, with its runtime first on PATH, and other programs start as asked', () =>
  Effect.gen(function* () {
    const { started, terminals } = recording();
    const wrapped = harnessTerminals(
      terminals,
      installsOf({
        codex: { path: '/home/.nvm/versions/node/v20/bin/codex', runtime: '/home/.nvm/versions/node/v20/bin' },
      }),
    );
    yield* Effect.scoped(
      wrapped.start(request('codex', ['exec'], { inherit: false, entries: [{ _tag: 'Set', name: 'PATH', value: '/usr/bin' }] })),
    );
    yield* Effect.scoped(wrapped.start(request('git', ['status'])));

    expect(started[0]?.program).toBe('/home/.nvm/versions/node/v20/bin/codex');
    expect(started[0]?.environment?.entries.at(-1)).toEqual({
      _tag: 'Set',
      name: 'PATH',
      value: '/home/.nvm/versions/node/v20/bin:/usr/bin',
    });
    expect(started[1]).toEqual(request('git', ['status']));
  }),
);
