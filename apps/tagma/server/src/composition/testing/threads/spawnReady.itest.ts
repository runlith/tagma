import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { dirname } from 'node:path';
import { Context, Effect, FileSystem, Layer, Stream } from 'effect';
import { GRANT_HEADER } from '../../../platform/contract/service/credentials.js';
import { grantFor } from '../../../platform/testing/grants.js';
import { APPROVAL_WAIT_HEADER, CALL_HEADER } from '../../../invocation/contract/wire/headers.js';
import { ThreadRecords } from '../../../thread-record/contract/service/records.js';
import { ThreadHarness } from '../../../threads/contract/service/engine.js';
import { ThreadRollouts } from '../../../threads/contract/service/rollouts.js';
import { birthsOf, inboxOf } from '../../../threads/testing/doubles.js';
import { makeDoorWorld } from '../doorFixture.js';
import { nativeLeads, subscriptionLogin } from '../claudeLogin.js';
import { holdThreads } from '../threadScope.js';

type Answer = { readonly status?: string; readonly code?: string; readonly threadId?: string };
const names = ['reader', 'builder', 'reviewer'];
const task = 'Read the module and report.';

const setup = Effect.gen(function* () {
  const world = yield* makeDoorWorld({
    models: (standing) => ({
      ...standing,
      request: (input) => ({ ...standing.request(input), stream: () => Stream.never }),
    }),
  });
  const account = yield* subscriptionLogin(world);
  yield* nativeLeads(world, account);
  const projectId = yield* world.stealthProject();
  yield* holdThreads(world);
  return { world, account, projectId };
});
class World extends Context.Service<World, Effect.Success<typeof setup>>()('testing/SpawnReady') {}

const parent = Effect.fnUntraced(function* () {
  const { world, account, projectId } = yield* World;
  const born = yield* birthsOf(world.runtime.owners).create({ projectId, createdBySessionId: null, account, approvalMode: 'bypass' });
  yield* world.op('read_settings', {}, `project=${projectId}`, { [GRANT_HEADER]: grantFor(born.thread.id) });
  return born.thread.id;
});
const spawn = Effect.fnUntraced(function* (lead: string, name: string, text = task, key?: string, worktree?: string) {
  const { world, projectId } = yield* World;
  return (yield* world.op('spawn_agent', { agentId: 'tagma', task: text, name, worktree }, `project=${projectId}`, {
    [GRANT_HEADER]: grantFor(lead),
    [APPROVAL_WAIT_HEADER]: '0',
    ...(key === undefined ? {} : { [CALL_HEADER]: key }),
  })).body as Answer;
});
const parallel = (lead: string) => Effect.forEach(names, (name) => spawn(lead, name), { concurrency: 'unbounded' });

layer(Layer.effect(World, setup).pipe(Layer.provideMerge(BunFileSystem.layer)), { excludeTestServices: true })(
  'parallel spawn_agent readiness',
  (it) => {
    it.effect('every parallel spawn starts its child while their journal lanes are held', () =>
      Effect.gen(function* () {
        const { world } = yield* World;
        const lead = yield* parent();
        const answers = yield* parallel(lead);
        expect(answers.map((answer) => answer.status)).toEqual(names.map(() => 'started'));
        const harness = Context.get(world.runtime.owners, ThreadHarness);
        for (const answer of answers) {
          expect((yield* harness.reads.snapshot(answer.threadId!)).activeRun).not.toBeNull();
        }
        expect(yield* Context.get(world.runtime.owners, ThreadRecords).subtree(lead)).toHaveLength(4);
      }),
    );

    it.effect('new calls recover matching named children after preparation fails without duplicating their births or tasks', () =>
      Effect.gen(function* () {
        const { world, projectId } = yield* World;
        const lead = yield* parent();
        const files = yield* FileSystem.FileSystem;
        const rollouts = Context.get(world.runtime.owners, ThreadRollouts);
        const directory = dirname((yield* rollouts.locate(lead))!);
        const before = yield* Effect.acquireUseRelease(
          files.chmod(directory, 0o500),
          () => parallel(lead),
          () => files.chmod(directory, 0o700).pipe(Effect.orDie),
        );
        expect(before).toMatchObject(names.map(() => ({ code: 'spawn-not-ready' })));
        const records = Context.get(world.runtime.owners, ThreadRecords);
        const harness = Context.get(world.runtime.owners, ThreadHarness);
        const stranded = yield* Effect.forEach(names, (name) => records.address(name, { threadId: lead, projectId }));
        for (const child of stranded) {
          expect(child).not.toBeNull();
          expect((yield* harness.reads.snapshot(child!.threadId)).latestRun).toBeNull();
        }
        expect(yield* spawn(lead, names[0]!, 'Different work.')).toMatchObject({ code: 'name-taken' });
        expect(yield* spawn(lead, names[0]!, task, undefined, 'new')).toMatchObject({ code: 'name-taken' });
        const recover = () => Effect.forEach(names, (name) => spawn(lead, name, task, `recover-${name}`), { concurrency: 'unbounded' });
        const recovered = yield* recover();
        expect(recovered).toMatchObject(stranded.map((child) => ({ status: 'started', threadId: child!.threadId })));
        expect(yield* recover()).toEqual(recovered);
        expect(yield* records.subtree(lead)).toHaveLength(4);
        for (const answer of recovered) {
          const state = yield* harness.reads.snapshot(answer.threadId!);
          expect(state.activeRun).not.toBeNull();
          expect(yield* inboxOf(world.runtime.owners).openRequests(answer.threadId!)).toHaveLength(1);
        }
        expect(yield* parallel(lead)).toMatchObject(names.map(() => ({ code: 'name-taken' })));
      }),
    );
  },
);
