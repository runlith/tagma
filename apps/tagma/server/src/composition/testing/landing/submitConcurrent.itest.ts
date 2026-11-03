import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Context, Deferred, Effect, Fiber, Schema } from 'effect';
import { RuleChecks } from '../../../enforcement/contract/service/ruleChecks.js';
import { Tags } from '../../../graph/contract/service/vocabulary.js';
import { LandingGit } from '../../../landing/contract/service/servedGit.js';
import { SubmitReceipt } from '../../../landing/contract/wire/receipt.js';
import { testSessionIdentity } from '../../../platform/testing/identity.js';
import { threadWireSnapshotPayloadSchema } from '../../../threads/contract/wire/snapshot.js';
import { WorkingOrigins } from '../../../workspace/contract/service/places.js';
import { fixtureNativeCatalog } from '../nativeCatalog.js';
import { suiteGit } from '../suiteGit.js';
import { nativeLanding } from './native.js';

it.live('concurrent landings of one session report only the lines still uncommitted when each receipt forms', () =>
  Effect.gen(function* () {
    const { world, root, projectId, doors, write, read } = yield* nativeLanding({
      'first.txt': 'base\n',
      'second.txt': 'base\n',
      'pending.txt': 'base\n',
    });
    const born = yield* world.op('create_thread', { approvalMode: 'trust' }, `project=${projectId}`);
    const {
      snapshot: { thread },
    } = yield* Schema.decodeUnknownEffect(threadWireSnapshotPayloadSchema)(born.body);
    const actor = yield* doors.doorsFor(thread.id, thread.ownerId);
    const owners = Context.mergeAll(world.routed, world.runtime.owners, world.runtime.workspace, world.runtime.enforcement);
    const origin = yield* Context.get(owners, WorkingOrigins).of({ projectId, threadId: thread.id }, root);
    const vocabulary = yield* Context.get(actor.served.context, Tags).of(projectId);
    const checks = Context.get(owners, RuleChecks);
    const checking = yield* Deferred.make<void>();
    const proceed = yield* Deferred.make<void>();
    const native = yield* fixtureNativeCatalog(
      {
        caller: {
          actor: {
            kind: 'thread',
            threadId: thread.id,
            projectId,
            principalId: thread.ownerId,
            session: { harness: 'tagma', key: thread.id },
          },
          files: null,
        },
        place: { root, origin },
        world: 'checkout',
        project: { id: projectId, name: 'test' },
        vocabulary: () => vocabulary,
        identity: testSessionIdentity,
        served: actor.served,
        owners: owners.pipe(
          Context.add(LandingGit, { run: (_act, platform) => Effect.succeed(platform) }),
          Context.add(
            RuleChecks,
            RuleChecks.of({
              ...checks,
              after: Effect.fnUntraced(function* (op, subject) {
                if (op === 'submit_work' && subject.kind === 'tree' && subject.paths.includes('first.txt')) {
                  yield* Deferred.succeed(checking, undefined);
                  yield* Deferred.await(proceed);
                }
                return yield* checks.after(op, subject);
              }),
            }),
          ),
        ),
      },
      ['submit_work'],
    );
    const placed = { ...actor, native };
    yield* write(thread.id, 'first.txt', null);
    yield* write(thread.id, 'second.txt', 'second\n');
    yield* write(thread.id, 'pending.txt', 'pending\n');
    const first = yield* Effect.forkScoped(
      doors.atNative(
        'submit_work',
        {
          subject: 'land first',
          paths: ['first.txt'],
          tasks: [],
        },
        placed,
      ),
    );
    yield* Deferred.await(checking).pipe(
      Effect.raceFirst(
        Fiber.join(first).pipe(
          Effect.flatMap((answer) => Effect.die(`first landing ended before its after-check: ${JSON.stringify(answer)}`)),
        ),
      ),
    );
    const second = yield* doors.atNative(
      'submit_work',
      {
        subject: 'land second',
        paths: ['second.txt'],
        tasks: [],
      },
      placed,
    );
    yield* Deferred.succeed(proceed, undefined);
    const completed = [yield* Fiber.join(first), second];
    for (const answer of completed) {
      expect(answer.class).toBe('answer');
      if (answer.class !== 'answer') return;
      const { submitted } = yield* Schema.decodeUnknownEffect(Schema.Struct({ submitted: SubmitReceipt }))(answer.value);
      expect(submitted.status).toBe('landed');
      if (submitted.status !== 'landed') return;
      expect(submitted.left).toEqual(['pending.txt']);
      expect(submitted.unrecorded ?? []).toEqual([]);
    }
    expect(yield* suiteGit(root, 'ls-tree', '--name-only', 'HEAD', '--', 'first.txt')).toBe('');
    expect(yield* read('second.txt')).toBe('second\n');
    expect(yield* suiteGit(root, 'status', '--porcelain', '--', 'first.txt', 'second.txt')).toBe('');
  }).pipe(Effect.provide(BunFileSystem.layer)),
);
