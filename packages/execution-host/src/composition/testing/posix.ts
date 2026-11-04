import { Context, Effect, FileSystem, Layer, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import * as BunServices from '@effect/platform-bun/BunServices';
import { userInfo } from 'node:os';
import { join } from 'node:path';
import { Adapter } from '../../holder/testing/Adapter';
import { command } from './commands';
import { testHolder, HOLDER_LIBRARY } from '../../posix/testing/holder';
import { loadLibrary } from '../../posix/Library';
import { processReader } from './native';
import { background } from '../../posix/testing/tempo';
import { ProcessesUnreadable } from '../../ProcessReader';
import { testSystem } from './system';

export const posix = () =>
  Layer.effectContext(
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const loaded = yield* loadLibrary(HOLDER_LIBRARY);
      const processes = yield* processReader(loaded);
      const system = yield* testSystem;
      const directory = yield* files.realPath(yield* files.makeTempDirectoryScoped({ prefix: 'execution-contracts-' }));
      const home = join(directory, 'home');
      yield* files.makeDirectory(home);
      const file = join(directory, 'file');
      yield* files.writeFileString(file, 'data');
      yield* files.writeFileString(join(directory, 'path-probe'), '#!/bin/sh\nprintf path-only', { mode: 0o700 });
      const read = Effect.fn('posix.contracts.read')(function* (path: string, args: ReadonlyArray<string>) {
        const child = yield* spawner.spawn(ChildProcess.make(path, args, { stdin: 'ignore', stdout: 'pipe', stderr: 'inherit' }));
        const text = Buffer.concat(yield* Stream.runCollect(child.stdout)).toString();
        if ((yield* child.exitCode) !== 0)
          return yield* new ProcessesUnreadable({ detail: `${path} did not return a contract observation` });
        return text;
      }, Effect.scoped);
      const priority = Effect.fnUntraced(function* (pid: number) {
        const value = (yield* read('/bin/ps', ['-o', system.priorityColumn, '-p', String(pid)])).trim();
        if (value.length === 0) return yield* new ProcessesUnreadable({ detail: `could not read priority of ${pid}` });
        return value;
      });
      return Context.make(
        Adapter,
        Adapter.of({
          exits: {
            hangup: { _tag: 'Signal', signal: 'SIGHUP' },
            interrupt: { _tag: 'Signal', signal: 'SIGINT' },
            terminate: { _tag: 'Signal', signal: 'SIGTERM' },
            kill: { _tag: 'Signal', signal: 'SIGKILL' },
          },
          directory,
          home,
          userHome: userInfo().homedir,
          file,
          missing: join(directory, 'no-program'),
          environment: { path: '/usr/bin/env', args: [] },
          cwd: { path: '/bin/pwd', args: [] },
          pathName: 'path-probe',
          searchPath: '/usr/bin:/bin',
          relativeSearchPath: '.',
          fixture: command,
          priority,
          background,
          priorities: (launcher) => Effect.map(priority(launcher), (full) => ({ full, ...system.priorities(full) })),
          standing: (pid) =>
            Effect.suspend(() => {
              const row = processes.identity(pid);
              return row._tag === 'Read'
                ? Effect.succeed(row.zombie ? ('zombie' as const) : ('running' as const))
                : row._tag === 'Gone'
                  ? Effect.succeed('gone' as const)
                  : Effect.fail(new ProcessesUnreadable({ detail: row.detail }));
            }),
          descriptors: (holder) =>
            Effect.suspend(() => {
              const logic = loaded.abi.descriptors(process.pid);
              const held = loaded.abi.descriptors(holder);
              if ('refusal' in logic) return Effect.fail(new ProcessesUnreadable({ detail: logic.detail }));
              if ('refusal' in held) return Effect.fail(new ProcessesUnreadable({ detail: held.detail }));
              return Effect.succeed({ logic: logic.count, holder: held.count });
            }),
          softLimits: read('/bin/bash', ['-c', 'ulimit -n; ulimit -u']),
        }),
      );
    }),
  ).pipe(Layer.provide(BunServices.layer));

export const heldPosix = (isolated = false) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const adapter = yield* Adapter;
      const scope = yield* Effect.scope;
      return yield* Effect.scoped(
        Effect.gen(function* () {
          yield* Effect.acquireRelease(
            Effect.sync(() => {
              const before = process.env.HOME;
              process.env.HOME = adapter.home;
              return before;
            }),
            (before) =>
              Effect.sync(() => {
                if (before === undefined) delete process.env.HOME;
                else process.env.HOME = before;
              }),
          );
          return yield* Layer.buildWithScope(testHolder(adapter.directory, undefined, undefined, isolated), scope);
        }),
      );
    }),
  ).pipe(Layer.provideMerge(posix()), Layer.provide(BunServices.layer));
