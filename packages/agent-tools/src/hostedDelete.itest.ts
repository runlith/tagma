import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Effect, FileSystem } from 'effect';
import { TestClock } from 'effect/testing';
import { join } from 'node:path';
import { hosted } from '@runlith/agent/thread/conformance/hostedWorld';
import { openMemoryStorage } from '@runlith/agent/thread/conformance/memoryStorage';
import { createDeleteTool } from './delete';
import { options, recorder } from './testing/toolHarness';

it.effect('a hosted deletion records and returns its result after a slow writer invalidates its preparation', () =>
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const root = yield* files.realPath(yield* files.makeTempDirectoryScoped({ prefix: 'hosted-delete-' }));
    const path = join(root, 'removed.ts');
    yield* files.writeFileString(path, 'export const removed = true;\n');
    const record = recorder();
    let deleted = false;
    const open = Effect.fnUntraced(function* () {
      const storage = yield* openMemoryStorage();
      return {
        ...storage,
        transitions: {
          ...storage.transitions,
          readAt: Effect.fnUntraced(function* (threadId, work, tx) {
            const prepared = yield* storage.transitions.readAt(threadId, work, tx);
            if (deleted && tx === undefined) {
              deleted = false;
              yield* TestClock.adjust('31 seconds');
              yield* storage.aggregate.update(threadId, { budgetTokens: 1 });
            }
            return prepared;
          }),
        },
      } satisfies typeof storage;
    });
    const tool = createDeleteTool(
      options({
        cwd: root,
        changes: {
          ...record.port,
          land: (changes, write) =>
            Effect.tap(record.port.land(changes, write), () =>
              Effect.sync(() => {
                deleted = true;
              }),
            ),
        },
      }),
    );
    const rig = yield* hosted(open, { delete: tool });
    const input = { args: ['--', path], glob: false };
    yield* rig.said(['remove', 'delete', input]);
    const answered = yield* Effect.result(rig.call('remove', 'delete', input));
    expect(yield* files.exists(path)).toBe(false);
    expect(answered).toMatchObject({ _tag: 'Success', success: { failed: false } });
    expect(yield* rig.entry('remove')).toMatchObject({ toolState: 'output-available' });
    if (answered._tag === 'Success') expect(yield* rig.call('remove', 'delete', input)).toEqual(answered.success);
  }).pipe(Effect.provide(BunFileSystem.layer)),
);
