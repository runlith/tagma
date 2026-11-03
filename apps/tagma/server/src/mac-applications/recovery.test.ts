import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Processes, ProcessesUnreadable, type ProcessFacts } from '@runlith/execution-host/ProcessReader';
import * as Memory from '@runlith/testbed/memory';
import { Deferred, Effect, Fiber, FileSystem, Stream } from 'effect';
import { TestClock } from 'effect/testing';
import { WindowDeclarations } from '../executions/contract/service/load.js';
import type { WindowProcess } from '../executions/contract/wire/load.js';
import { recoverApplications } from './recovery.js';

it.effect('an unchanged window retries a lost process reader and removes only its proven main application’s outgoing bundle', () =>
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const own = '/people/alex/Tools/Tagma.app';
    const other = '/people/alex/Tools/Other.app';
    const outgoing = '/people/alex/Tools/.Tagma.app.outgoing';
    const unrelated = '/people/alex/Tools/.Other.app.outgoing';
    for (const bundle of [own, other, outgoing, unrelated]) {
      yield* files.makeDirectory(`${bundle}/Contents/Resources`, { recursive: true });
      yield* files.writeFileString(`${bundle}/Contents/Resources/default_app.asar`, bundle);
    }
    const processes: readonly WindowProcess[] = [
      { pid: 10, createdMs: 100, kind: 'main', documents: [] },
      { pid: 11, createdMs: 100, kind: 'renderer', documents: [] },
      { pid: 12, createdMs: 100, kind: 'main', documents: [] },
    ];
    const parts = processes.map((process) => ({
      key: `window:${process.pid}`,
      pid: process.pid,
      createdMs: process.createdMs,
      precisionMs: 1,
    }));
    const facts = (pid: number): ProcessFacts => ({
      pid,
      birth: pid === 12 ? 'reused' : `birth:${pid}`,
      parent: 1,
      work: pid,
      args: { _tag: 'Read', value: [] },
      executable: { _tag: 'Read', value: `${pid === 10 ? own : other}/Contents/MacOS/Tagma` },
      folder: { _tag: 'Read', value: '/' },
    });
    const firstPass = yield* Deferred.make<void>();
    let failed = false;
    const recovery = yield* Effect.forkScoped(
      recoverApplications.pipe(
        Effect.provideService(
          WindowDeclarations,
          WindowDeclarations.of({
            declare: () => Effect.die('declarations already arrived'),
            end: () => Effect.die('the window is still connected'),
            parts: Stream.concat(Stream.succeed(parts), Stream.never),
            declared: Effect.succeed(parts),
            part: (key) => {
              const process = processes.find((process) => key === `window:${process.pid}`);
              return process === undefined ? undefined : { host: 'window', process };
            },
            views: () => [],
          }),
        ),
        Effect.provideService(
          Processes,
          Processes.of({
            scan: () => Effect.die('no process table is needed'),
            table: Effect.die('no process table is needed'),
            members: () => Effect.die('no process group is needed'),
            facts: Effect.fnUntraced(function* (pids: readonly number[]) {
              if (!failed) {
                failed = true;
                yield* Deferred.succeed(firstPass, undefined);
                return yield* new ProcessesUnreadable({ detail: 'the process reader ended before answering' });
              }
              return { processes: pids.map(facts), unread: [] };
            }),
            identity: () => ({ _tag: 'Unreadable', detail: 'resolve owns the witness' }),
            resolve: (part) => ({ pid: part.pid, birth: `birth:${part.pid}` }),
            compareBirth: () => {
              throw new Error('births are opaque');
            },
            bornBetween: () => {
              throw new Error('resolve owns creation-time matching');
            },
          }),
        ),
      ),
    );
    yield* Deferred.await(firstPass);
    expect(yield* files.exists(outgoing)).toBe(true);
    yield* TestClock.adjust('1 second');
    expect(yield* files.exists(outgoing)).toBe(false);
    expect(yield* files.readFileString(`${own}/Contents/Resources/default_app.asar`)).toBe(own);
    expect(yield* files.readFileString(`${unrelated}/Contents/Resources/default_app.asar`)).toBe(unrelated);
    yield* files.makeDirectory(outgoing);
    yield* files.writeFileString(`${outgoing}/later`, 'after recovery');
    yield* TestClock.adjust('1 second');
    expect(yield* files.readFileString(`${outgoing}/later`)).toBe('after recovery');
    yield* Fiber.interrupt(recovery);
  }).pipe(Effect.provide(Memory.layer)),
);
