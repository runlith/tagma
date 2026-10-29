import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { Context, Effect, FileSystem, Schedule } from 'effect';
import { eq } from 'drizzle-orm';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { RolloutReads } from '../../../threads/contract/service/rolloutReads.js';
import { birthsOf, rolloutsOf, threadEvent, threadRolloutHome } from '../../../threads/testing/doubles.js';
import { makeDoorWorld } from '../doorFixture.js';

it.live('a start reconciles only the rollouts marked with an unfinished write, from a new install on', () =>
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const world = yield* makeDoorWorld({ drivers: ['rollout-reconciling'], own: 'the test opens the runtime maintenance gate once' });
    const { runtime, dataHome: data } = world;
    const { db } = Context.get(runtime.graph, MachineStore);
    const rollouts = rolloutsOf(runtime.owners);
    const home = join(data, 'threads');
    const pending = join(home, '.pending');
    yield* files.remove(home, { recursive: true, force: true });
    yield* runtime.openMaintenance;
    yield* db
      .select()
      .from(threadRolloutHome())
      .pipe(Effect.repeat({ until: (rows) => rows.length > 0, schedule: Schedule.spaced(25) }));

    const projectId = yield* world.stealthProject();
    const behind = Effect.fnUntraced(function* (title: string) {
      const threadId = (yield* birthsOf(runtime.owners).create({ projectId, createdBySessionId: null, title })).thread.id;
      yield* rollouts.ensure(threadId);
      const path = join(home, String(projectId), `${threadId}.jsonl`);
      const entry = { type: 'message', id: `said-${threadId}`, role: 'user', text: title };
      yield* files.writeFileString(
        path,
        `${JSON.stringify({ kind: 'event', row: { threadId, position: 1, id: `ev-${threadId}`, kind: 'message', payload: { entry } } })}\n`,
        { flag: 'a' },
      );
      yield* files.remove(join(pending, threadId), { force: true });
      return { threadId, path };
    });
    const marked = yield* behind('the thread written when the server stopped');
    const quiet = yield* behind('the thread nobody wrote');
    yield* files.makeDirectory(pending, { recursive: true });
    yield* files.writeFileString(join(pending, marked.threadId), marked.path);

    const read = new Set<string>();
    yield* rollouts.replay().pipe(Effect.provideService(RolloutReads, ({ path }) => void read.add(path)));

    expect(read.has(marked.path)).toBe(true);
    expect([...read].filter((path) => path.startsWith(home) && !path.startsWith(marked.path))).toEqual([]);
    const events = (threadId: string) =>
      db.select({ id: threadEvent().id }).from(threadEvent()).where(eq(threadEvent().threadId, threadId));
    expect((yield* events(marked.threadId)).map((row) => row.id)).toEqual([`ev-${marked.threadId}`]);
    expect(yield* files.exists(join(pending, marked.threadId))).toBe(false);
    expect(yield* events(quiet.threadId)).toEqual([]);
  }).pipe(Effect.provide(BunFileSystem.layer)),
);
