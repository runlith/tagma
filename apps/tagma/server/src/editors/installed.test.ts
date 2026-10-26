import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Context, Deferred, Effect, Sink, Stream } from 'effect';
import { TestClock } from 'effect/testing';
import { ChildProcessSpawner } from 'effect/process';
import { EditorHost, LookupFailed, type Sighting } from './contract/service/host.js';
import { makeEditors } from './installed.js';

const spawned: { program: string; args: readonly string[] }[] = [];

const spawner = ChildProcessSpawner.make((command) =>
  Effect.sync(() => {
    if (command._tag === 'StandardCommand') spawned.push({ program: command.command, args: command.args });
    return ChildProcessSpawner.makeHandle({
      pid: ChildProcessSpawner.ProcessId(1),
      exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
      isRunning: Effect.succeed(false),
      kill: () => Effect.void,
      stdin: Sink.drain,
      stdout: Stream.empty,
      stderr: Stream.empty,
      all: Stream.empty,
      getInputFd: () => Sink.drain,
      getOutputFd: () => Stream.empty,
      unref: Effect.succeed(Effect.void),
    });
  }),
);

const machine = (find: EditorHost['Service']['find']) =>
  Context.make(EditorHost, EditorHost.of({ find, opener: (url) => ({ program: 'open', args: [url] }) })).pipe(
    Context.add(ChildProcessSpawner.ChildProcessSpawner, spawner),
  );

const sighted = (sightings: readonly Sighting[]) =>
  machine((entries) =>
    Effect.succeed(entries.map((entry) => sightings.find((one) => one.id === entry.id) ?? { id: entry.id, found: 'absent' as const })),
  );

it.effect('the installed editors come in catalog order, and one whose check failed is left out alone', () =>
  Effect.gen(function* () {
    const editors = yield* Effect.provide(
      makeEditors,
      sighted([
        { id: 'zed', found: 'installed', launcher: { program: '/Zed.app/Contents/MacOS/cli', prefix: [] }, icon: null },
        { id: 'vscode', found: 'failed', reason: 'LaunchServices refused com.microsoft.VSCode' },
        { id: 'cursor', found: 'installed', launcher: null, icon: 'data:image/png;base64,AA==' },
      ]),
    );
    expect(yield* editors.list).toEqual({
      editors: [
        { id: 'cursor', name: 'Cursor', icon: 'data:image/png;base64,AA==' },
        { id: 'zed', name: 'Zed', icon: null },
      ],
      failure: null,
    });
    const lost = yield* Effect.provide(
      makeEditors,
      machine(() => Effect.fail(new LookupFailed({ message: 'osascript is gone' }))),
    );
    expect(yield* lost.list).toEqual({ editors: [], failure: 'osascript is gone' });
  }),
);

it.effect('an editor with a command line opens the checkout at the line, one without it its deep link', () =>
  Effect.gen(function* () {
    spawned.length = 0;
    const editors = yield* Effect.provide(
      makeEditors,
      sighted([
        { id: 'vscode', found: 'installed', launcher: { program: '/Code.app/bin/code', prefix: [] }, icon: null },
        { id: 'cursor', found: 'installed', launcher: null, icon: null },
      ]),
    );
    const target = { root: '/work/app', file: '/work/app/src/my file#2.ts', line: 80 };
    yield* editors.open('vscode', target);
    yield* editors.open('cursor', target);
    expect(spawned).toEqual([
      { program: '/Code.app/bin/code', args: ['/work/app', '-g', '/work/app/src/my file#2.ts:80'] },
      { program: 'open', args: ['cursor://file/work/app/src/my%20file%232.ts:80'] },
    ]);
  }),
);

it.effect('a stale answer is read at once while the next search still runs', () =>
  Effect.gen(function* () {
    const held = yield* Deferred.make<void>();
    let searches = 0;
    const zed: Sighting = { id: 'zed', found: 'installed', launcher: null, icon: null };
    const editors = yield* Effect.provide(
      makeEditors,
      machine((entries) => {
        searches += 1;
        const answer = entries.map((entry): Sighting => (entry.id === 'zed' ? zed : { id: entry.id, found: 'absent' }));
        return searches === 1 ? Effect.succeed(answer) : Effect.as(Deferred.await(held), answer);
      }),
    );
    const first = yield* editors.list;
    yield* TestClock.adjust('6 minutes');
    expect(yield* editors.list).toEqual(first);
    yield* Deferred.succeed(held, undefined);
  }),
);
