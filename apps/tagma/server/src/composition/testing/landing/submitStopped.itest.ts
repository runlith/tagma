import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { makeAgentCalls } from '@runlith/agent/AgentCalls';
import { RunStop } from '@runlith/agent/RunStop';
import { openToolDoor, ToolJudge } from '@runlith/agent/door/openToolDoor';
import { ToolAnswer, toolSettleEffect } from '@runlith/agent/tool';
import { callerInThread, unthreadedCaller } from '../callers.js';
import { builtinMode } from '../modes.js';
import { contentDigest } from '@runlith/files/content';
import { workspaceChangeHunk } from '@runlith/files/hunk';
import { Clock, Context, Deferred, Effect, Fiber, FileSystem, Schema } from 'effect';
import { join } from 'node:path';
import { ChangeRecord } from '../../../change-record/contract/service/record.js';
import { RuleChecks } from '../../../enforcement/contract/service/ruleChecks.js';
import { Tags } from '../../../graph/contract/service/vocabulary.js';
import { LandingGit } from '../../../landing/contract/service/servedGit.js';
import { testSessionIdentity } from '../../../platform/testing/identity.js';
import { spawnedEffect } from '../../../platform/testing/spawn.js';
import { threadWireSnapshotPayloadSchema } from '../../../threads/contract/wire/snapshot.js';
import { WorkingOrigins } from '../../../workspace/contract/service/places.js';
import { lineWrites } from '../../lineWrites.js';
import { makeDoorWorld } from '../doorFixture.js';
import { fixtureNativeCatalog } from '../nativeCatalog.js';
import { git } from '../threadDoors.js';
import { seedRepository } from './native.js';

it.live(
  'stopping submit_work after publication preserves its landed commit and a fresh native door reads the same call receipt',
  () =>
    Effect.gen(function* () {
      const world = yield* makeDoorWorld();
      const files = yield* FileSystem.FileSystem;
      const root = yield* files.realPath(yield* world.directory('checkout'));
      const path = join(root, 'shared.ts');
      const before = 'export const value = 1;\n';
      const after = 'export const value = 2;\n';
      yield* files.writeFileString(path, before);
      yield* seedRepository(root);
      yield* git(root, 'add', 'shared.ts');
      yield* git(root, 'commit', '-qm', 'base');
      const made = yield* world.op('add_project', { name: world.uniqueName(), rootPath: root, storage: 'stealth' });
      const projectId = (made.body as { project: { id: number } }).project.id;
      const born = yield* world.op('create_thread', { approvalMode: 'bypass' }, `project=${projectId}`);
      const {
        snapshot: { thread },
      } = yield* Schema.decodeUnknownEffect(threadWireSnapshotPayloadSchema)(born.body);
      const served = yield* world.runtime.pool.resolve({ projectId, cwd: root });
      const owners = Context.mergeAll(world.routed, world.runtime.owners, world.runtime.workspace, world.runtime.enforcement);
      const origin = yield* Context.get(owners, WorkingOrigins).of({ projectId, threadId: thread.id }, root);
      const vocabulary = yield* Context.get(served.context, Tags).of(projectId);
      const published = yield* Deferred.make<string>();
      const checks = Context.get(owners, RuleChecks);
      const catalog = (waiting: boolean) =>
        fixtureNativeCatalog(
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
            served,
            owners: owners.pipe(
              Context.add(LandingGit, { run: (_act, platform) => Effect.succeed(platform) }),
              Context.add(
                RuleChecks,
                RuleChecks.of({
                  ...checks,
                  after: (op, subject) =>
                    waiting && op === 'submit_work' && subject.kind === 'tree'
                      ? Effect.andThen(Deferred.succeed(published, subject.commit), Effect.never)
                      : checks.after(op, subject),
                }),
              ),
            ),
          },
          ['submit_work'],
        );
      expect(
        yield* Context.get(owners, ChangeRecord).land(
          { work: { projectId, threadId: thread.id } },
          [
            {
              path,
              origin: 'edit',
              before: contentDigest(before),
              after: contentDigest(after),
              beforeText: before,
              afterText: after,
              hunk: workspaceChangeHunk(before, after),
              at: new Date(yield* Clock.currentTimeMillis),
            },
          ],
          lineWrites.replace({ root, path: 'shared.ts', before, after }, Effect.succeed(true)),
        ),
      ).toMatchObject({ _tag: 'written', kept: true });
      const tool = (yield* catalog(true)).submit_work!;
      const calls = yield* makeAgentCalls({ history: 1 });
      const stop = new RunStop();
      const runId = 'run-submit';
      const toolCallId = 'submit-published';
      calls.bind(runId, stop);
      const door = openToolDoor(
        runId,
        callerInThread(thread.id, runId),
        {},
        new ToolJudge(builtinMode('bypass')),
        undefined,
        undefined,
        undefined,
        undefined,
        calls,
      );
      const input = { subject: 'land before stopping', paths: ['shared.ts'], json: true };
      const running = yield* Effect.forkScoped(door.settle({ name: 'submit_work', tool, input, options: { toolCallId, messages: [] } }));
      const commit = yield* Deferred.await(published).pipe(
        Effect.raceFirst(
          Fiber.join(running).pipe(
            Effect.flatMap((outcome) => Effect.die(`submit_work ended before its after-check: ${JSON.stringify(outcome.output)}`)),
          ),
        ),
      );
      stop.stop(new Error('The run was stopped.'));
      const outcome = yield* Fiber.join(running);
      expect(outcome.output).toMatchObject({ output: { submitted: { status: 'landed', commit, committed: ['shared.ts'] } } });
      const head = yield* spawnedEffect(['git', 'rev-parse', 'HEAD'], { cwd: root });
      expect(new TextDecoder().decode(head.stdout).trim()).toBe(commit);
      const fresh = (yield* catalog(false)).submit_work!;
      const read = toolSettleEffect(fresh, { toolCallId, toolInput: input, caller: unthreadedCaller, json: true });
      if (read === null) return yield* Effect.die('submit_work has no read-back');
      const receipt = yield* read;
      expect(receipt.status).toBe('completed');
      if (receipt.status !== 'completed') return;
      const answer = receipt.output instanceof ToolAnswer ? receipt.output.value : receipt.output;
      expect(answer).toMatchObject({
        submitted: { status: 'landed', commit, committed: ['shared.ts'], unrecorded: [{ step: 'receipt' }] },
      });
      const other = toolSettleEffect(fresh, { toolCallId: 'another-call', toolInput: input, caller: unthreadedCaller, json: true });
      if (other === null) return yield* Effect.die('submit_work has no read-back');
      expect(yield* other).toEqual({ status: 'unknown' });
    }).pipe(Effect.provide(BunFileSystem.layer)),
  60_000,
);
