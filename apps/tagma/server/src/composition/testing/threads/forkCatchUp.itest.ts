import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { sql } from 'drizzle-orm';
import { Context, Effect, FileSystem, Layer, Schedule } from 'effect';
import { layer } from '@runlith/effect-test';
import { threadEntryEvent } from '@runlith/agent/thread/events';
import { userMessageEntryId } from '@runlith/agent/transcript/entryNames';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { OPERATOR_PRINCIPAL } from '../../../platform/contract/wire/actor.js';
import { Conversations } from '../../../threads/contract/service/conversations.js';
import { ThreadHarness } from '../../../threads/contract/service/engine.js';
import { ThreadRollouts } from '../../../threads/contract/service/rollouts.js';
import { birthsOf, rewindsOf } from '../../../threads/testing/doubles.js';
import { makeDoorWorld, projectLeaving } from '../doorFixture.js';

const makeWorld = Effect.gen(function* () {
  const world = yield* makeDoorWorld();
  const projectId = yield* world.stealthProject();
  yield* projectLeaving(world, projectId);
  return { runtime: world.runtime, projectId };
});

class World extends Context.Service<World, Effect.Success<typeof makeWorld>>()('testing/ForkWorld') {}

//! Past one export page and one catch-up batch, so both continue across their boundary.
const TURNS = 65;
const EVENTS = TURNS * 2;

const said = (turn: number, role: 'user' | 'assistant', text: string) =>
  threadEntryEvent({
    type: 'message',
    id: role === 'user' ? userMessageEntryId(`run-${turn}`) : `message:assistant:run-${turn}`,
    runId: `run-${turn}`,
    role,
    text,
    occurredAt: new Date(Date.UTC(2026, 9, 1, 8, turn)).toISOString(),
  });

const until = <A, E, R>(read: Effect.Effect<A, E, R>, done: (value: A) => boolean) =>
  read.pipe(Effect.repeat({ until: done, schedule: Schedule.spaced('20 millis') }));

const found = Effect.fnUntraced(function* (threadId: string, query: string) {
  const { runtime } = yield* World;
  const page = yield* Context.get(runtime.owners, Conversations).search(
    { kind: 'operator' },
    { scope: { kind: 'all', removed: [] }, limit: 20, query, threadId },
  );
  return page.matches.map((hit) => hit.match.entryId);
});

const rolloutOf = Effect.fnUntraced(function* (threadId: string) {
  const { runtime, projectId } = yield* World;
  const path = Context.get(runtime.owners, ThreadRollouts).pathOf(projectId, threadId);
  if (path === undefined) return yield* Effect.die('the runtime keeps no rollouts');
  return path;
});

const positions = Effect.fn('testing.forkRolloutPositions')(function* (path: string) {
  const files = yield* FileSystem.FileSystem;
  const text = yield* files.readFileString(path).pipe(Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeed('')));
  return text
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as { readonly kind?: string; readonly row?: { readonly position: number } })
    .filter((record) => record.kind === 'event')
    .map((record) => record.row?.position);
});

const branchOf = Effect.fnUntraced(function* (title: string, sharedSource?: string) {
  const { runtime, projectId } = yield* World;
  const source = sharedSource ?? (yield* birthsOf(runtime.owners).create({ projectId, createdBySessionId: null, title })).thread.id;
  if (sharedSource === undefined) {
    const handle = Context.get(runtime.owners, ThreadHarness).threads.handle(source, OPERATOR_PRINCIPAL);
    const turns = Array.from({ length: TURNS - 1 }, (_, at) => [
      said(at + 2, 'user', `question number ${at + 2}`),
      said(at + 2, 'assistant', `answer number ${at + 2}`),
    ]).flat();
    yield* handle.append([
      said(1, 'user', 'where does the quokka sleep'),
      said(1, 'assistant', 'the quokka sleeps under saltbush'),
      ...turns,
    ]);
  }
  const child = (yield* rewindsOf(runtime.owners).branch(source, projectId, {})).threadId;
  const branch = Context.get(runtime.owners, ThreadHarness).threads.handle(child, OPERATOR_PRINCIPAL);
  return { source, child, append: (events: Parameters<typeof branch.append>[0]) => branch.append(events) };
});

layer(Layer.effect(World, makeWorld).pipe(Layer.provideMerge(BunFileSystem.layer)), { excludeTestServices: true, timeout: '60 seconds' })(
  'a fork behind its birth',
  (it) => {
    it.effect('a fork finds its prefix and exports only its tail, including the first append after an interrupted export', () =>
      Effect.gen(function* () {
        const { runtime } = yield* World;
        const files = yield* FileSystem.FileSystem;
        const { source, child, append } = yield* branchOf('caught up');
        yield* append([said(TURNS + 1, 'user', 'and in winter')]);
        expect(yield* until(found(child, 'saltbush'), (hits) => hits.length > 0)).toEqual(['message:assistant:run-1']);
        expect(yield* found(source, 'saltbush')).toEqual(['message:assistant:run-1']);
        expect(yield* until(found(child, 'winter'), (hits) => hits.length > 0)).toEqual([userMessageEntryId(`run-${TURNS + 1}`)]);
        expect(yield* positions(yield* rolloutOf(child))).toEqual([EVENTS + 1]);
        const interrupted = yield* branchOf('interrupted export', source);
        const path = yield* rolloutOf(interrupted.child);
        yield* until(files.exists(path), (exists) => exists);
        yield* files.remove(path);
        yield* Context.get(runtime.graph, MachineStore).db.run(
          sql`delete from thread_rollout_cursor where thread_id = ${interrupted.child}`,
        );
        yield* interrupted.append([said(TURNS + 1, 'user', 'and in spring')]);
        expect(yield* positions(path)).toEqual([EVENTS + 1]);
      }),
    );
  },
);
