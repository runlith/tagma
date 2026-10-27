import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Deferred, Effect, Fiber } from 'effect';
import { dirname, join } from 'node:path';
import { ToolAnswer, toolSettleEffect } from '@runlith/agent/tool';
import { createDeleteTool } from './delete';
import type { RemovalReport } from './removal/model';
import { unthreadedCaller } from './testing/caller';
import { answer, createTempDir, exists, host, options, recorder } from './testing/toolHarness';
import { machineWorld } from './world/machine';

it.live('stopping in the middle of a recursive walk reports the removed entries and the root left standing', () =>
  Effect.gen(function* () {
    const dir = yield* host.realpath(yield* createTempDir());
    for (const name of ['first', 'second', 'third']) yield* host.writeFile(join(dir, name), 'walked\n');
    const reading = yield* Deferred.make<void>();
    const tool = createDeleteTool(
      options({
        cwd: dirname(dir),
        world: {
          ...machineWorld,
          entries: { ...machineWorld.entries!, readAll: () => Effect.andThen(Deferred.succeed(reading, undefined), Effect.never) },
        },
        changes: {
          ...recorder().port,
          records: (paths) => Effect.succeed(paths.map((path) => path.endsWith('/third'))),
        },
      }),
    );
    const input = { args: ['-r', dir], glob: false };
    const running = yield* Effect.forkChild(answer(tool, input));
    yield* Deferred.await(reading);
    yield* Fiber.interrupt(running);
    expect((yield* host.readdir(dir)).length).toBe(1);
    const readBack = yield* toolSettleEffect(tool, { toolCallId: 'call-1', caller: unthreadedCaller, toolInput: input })!;
    if (readBack.status !== 'completed' || !(readBack.output instanceof ToolAnswer)) return yield* Effect.die('No completed read-back.');
    expect(readBack.output.verdict).toEqual({ kind: 'cancelled' });
    const report = readBack.output.value as RemovalReport;
    expect(report.counts).toMatchObject({ removed: 2, unprocessed: 1 });
    expect(report.results.map((row) => [row.path, row.status, row.removed])).toEqual([[dir, 'unprocessed', 2]]);
    tool.settled?.({ toolCallId: 'call-1', caller: unthreadedCaller });
  }),
);

it.live('stopping during the next read retains completed deletions and the full spilled report', () =>
  Effect.gen(function* () {
    const dir = yield* createTempDir();
    const files = ['first', 'second', 'then/third'].map((name) => join(dir, name));
    yield* host.mkdir(join(dir, 'then'));
    for (const path of files) yield* host.writeFile(path, 'kept until selected\n');
    const reading = yield* Deferred.make<void>();
    const blocked = yield* Deferred.make<boolean>();
    const recorded = recorder();
    const tool = createDeleteTool(
      options({
        cwd: dir,
        world: { ...machineWorld, environment: { ...machineWorld.environment, tmp: dir } },
        changes: {
          ...recorded.port,
          records: (paths) =>
            paths.some((path) => path.endsWith('/third'))
              ? Effect.andThen(
                  Deferred.succeed(reading, undefined),
                  Effect.as(
                    Deferred.await(blocked),
                    paths.map(() => true),
                  ),
                )
              : Effect.succeed(paths.map(() => true)),
        },
      }),
    );
    const prefix = './'.repeat(13_000);
    const input = { args: ['-v', ...files.map((path) => prefix + path.slice(dir.length + 1))], glob: false };
    const running = yield* Effect.forkChild(answer(tool, input));
    yield* Deferred.await(reading);
    yield* Fiber.interrupt(running);
    expect(yield* exists(files[0]!)).toBe(false);
    expect(yield* exists(files[1]!)).toBe(false);
    expect(yield* exists(files[2]!)).toBe(true);
    expect(recorded.changes.map((change) => change.origin)).toEqual(['delete', 'delete']);
    const readBack = yield* toolSettleEffect(tool, { toolCallId: 'call-1', caller: unthreadedCaller, toolInput: input })!;
    expect(readBack.status).toBe('completed');
    if (readBack.status !== 'completed' || !(readBack.output instanceof ToolAnswer))
      return yield* Effect.die('No completed deletion read-back.');
    expect(readBack.output.verdict).toEqual({ kind: 'cancelled' });
    const source = readBack.output.source;
    if (source === undefined) return yield* Effect.die('The deletion report did not spill.');
    const text = yield* host.readFile(source.path, 'utf8');
    expect(Buffer.byteLength(text)).toBe(source.byteLength);
    const rows = text
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(rows.map((row) => row.status)).toEqual(['removed', 'removed', 'unprocessed', 'cancelled']);
    expect(rows[0].operands).toEqual([input.args[1]]);
    tool.settled?.({ toolCallId: 'call-1', caller: unthreadedCaller });
  }),
);
