import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { Context, Deferred, Effect, Fiber, Layer, Stream } from 'effect';
import { join } from 'node:path';
import { createTools } from '@runlith/agent-tools';
import { unruledTimes } from '@runlith/agent-tools/CommandWork';
import { toolExecute, toolPrepare, type Tool } from '@runlith/agent/tool';
import { ChangeRecord } from '../../../change-record/contract/service/record.js';
import { HeldFeed } from '../../../change-record/contract/service/held.js';
import { ThreadChanges } from '../../../change-record/contract/service/threadChanges.js';
import { Retirement } from '../../../change-record/contract/service/retirement.js';
import { RootId } from '../../../workspace/contract/wire/ids.js';
import { spawnedEffect } from '../../../platform/testing/spawn.js';
import { makeMachineWorld } from '../../../executions/testing/doubles.js';
import { callerInThread } from '../callers.js';
import { fileReady } from '../change-record/commandWorld.js';
import { doorFixture } from '../doorFixture.js';
import { nativeLanding } from './native.js';

const call = Effect.fnUntraced(function* (tool: Tool, thread: string, input: unknown) {
  const invocation = { toolCallId: crypto.randomUUID(), caller: callerInThread(thread, 'run'), messages: [] };
  const prepared = yield* toolPrepare(tool)!(input, invocation);
  return yield* toolExecute(tool)!(input, { ...invocation, prepared: prepared.prepared });
});

const setup = nativeLanding(
  {
    'value.ts': 'export const value = 1;\n',
    'tagma.config.ts': 'export default { format: { shape: { run: ["sh", "format.sh"], files: ["value.ts"] } } };\n',
    'format.sh': 'for file in "$@"; do tr -d ";" < "$file" > "$file.next" && mv "$file.next" "$file"; done\n',
    'package.json': '{"scripts":{"test":"bun test-command.js"}}\n',
    'test-command.js':
      'const fs = require("node:fs"); fs.writeFileSync(".git/testing", ""); const finish = () => { if (fs.existsSync(".git/test-done")) observer.close(); }; const observer = fs.watch(".git", finish); finish();\n',
  },
  { tools: ['submit_work', 'read_changes'] },
).pipe(Effect.provide(BunFileSystem.layer));

class Landing extends Context.Service<Landing, Effect.Success<typeof setup>>()('testing/SubmissionRecord') {}

layer(Layer.effect(Landing, setup).pipe(Layer.provide(doorFixture())), { excludeTestServices: true })('submission record', (it) => {
  it.effect('a formatted native landing is known while the session’s command runs and remains known after it ends', () =>
    Effect.gen(function* () {
      const { world, files, root, projectId, born, doors, read } = yield* Landing;
      const actor = yield* born();
      const record = Context.get(world.runtime.owners, ChangeRecord);
      const tools = createTools({
        cwd: root,
        world: makeMachineWorld(() => null),
        changes: record.changes({ work: { projectId, threadId: actor.threadId } }),
        commandTimes: unruledTimes,
        searchMs: 1000,
      });
      yield* call(tools.edit!, actor.threadId, { path: join(root, 'value.ts'), oldString: 'value = 1', newString: 'value = 2' });
      const testing = yield* Effect.forkChild(call(tools.bash!, actor.threadId, { command: 'bun run test', description: 'Run the tests' }));
      yield* fileReady(join(root, '.git', 'testing'));
      const opened = yield* Deferred.make<void>();
      const visible = yield* Deferred.make<string>();
      const sideGone = yield* Deferred.make<void>();
      const sideVisible = yield* Deferred.make<string>();
      yield* Effect.forkScoped(
        Stream.runForEach(Context.get(world.runtime.owners, ThreadChanges).subscribe(projectId, actor.threadId, null, 10), (frame) =>
          Effect.gen(function* () {
            if (frame.kind === 'whole') yield* Deferred.succeed(opened, undefined);
            const commits = frame.kind === 'whole' ? frame.commits : frame.commits?.list;
            const first = commits?.[0];
            if (first !== undefined) yield* Deferred.succeed(visible, first.sha);
            const side = commits?.find((commit) => commit.subject === 'side landed');
            if (side !== undefined) yield* Deferred.succeed(sideVisible, side.sha);
            if (frame.kind === 'change' && frame.checkouts.some((checkout) => checkout.gone.includes('side.ts')))
              yield* Deferred.succeed(sideGone, undefined);
          }),
        ),
      );
      yield* Deferred.await(opened);
      const submitted = yield* doors.atNative('submit_work', { subject: 'land while tests run' }, actor);
      expect(submitted).toMatchObject({ class: 'answer', value: { submitted: { status: 'landed', committed: ['value.ts'] } } });
      if (submitted.class !== 'answer') return;
      const commit = (submitted.value as { submitted: { commit: string } }).submitted.commit;
      expect(yield* Deferred.await(visible)).toBe(commit);
      expect(yield* read('value.ts')).toBe('export const value = 2\n');
      expect(yield* doors.atNative('read_changes', { limit: 10 }, actor)).toMatchObject({
        class: 'answer',
        value: {
          held: { paths: 0 },
          commits: expect.arrayContaining([expect.objectContaining({ sha: commit })]),
          turns: [expect.objectContaining({ path: 'value.ts', state: 'committed', commit })],
        },
      });
      yield* call(tools.write!, actor.threadId, { path: join(root, 'side.ts'), content: 'export const side = true;\n' });
      expect(yield* doors.atNative('read_changes', { limit: 10 }, actor)).toMatchObject({
        class: 'answer',
        value: {
          held: { paths: 1 },
          commits: expect.arrayContaining([expect.objectContaining({ sha: commit })]),
          turns: expect.arrayContaining([
            expect.objectContaining({ path: 'value.ts', state: 'committed', commit }),
            expect.objectContaining({ path: 'side.ts', state: 'held' }),
          ]),
        },
      });
      const current = yield* doors.atNative('read_changes', { limit: 10 }, actor);
      if (current.class !== 'answer') return yield* Effect.die('The native change read failed.');
      const checkout = RootId.make((current.value as { checkouts: { checkout: string }[] }).checkouts[0]!.checkout);
      const retirement = Context.get(world.runtime.owners, Retirement);
      let sideCommit = '';
      yield* retirement.lease(
        checkout,
        Effect.gen(function* () {
          yield* call(tools.bash!, actor.threadId, {
            command: 'git add side.ts && git -c user.name=t -c user.email=t@t commit -qm "side landed"',
            description: 'Land the side file',
          });
          const head = yield* spawnedEffect(['git', 'rev-parse', 'HEAD'], { cwd: root });
          expect(head.exitCode).toBe(0);
          sideCommit = new TextDecoder().decode(head.stdout).trim();
          yield* Deferred.await(sideGone);
          yield* retirement.pass(checkout);
          expect(yield* Deferred.await(sideVisible)).toBe(sideCommit);
        }),
      );
      const retired = yield* Deferred.make<void>();
      yield* Effect.acquireRelease(
        Effect.sync(() =>
          Context.get(world.runtime.owners, HeldFeed).heldChanged((change) =>
            change.threadId === actor.threadId && change.moved.places.some((place) => place.path === 'value.ts')
              ? Effect.asVoid(Deferred.succeed(retired, undefined))
              : Effect.void,
          ),
        ),
        (unsubscribe) => Effect.sync(unsubscribe),
      );
      yield* files.writeFileString(join(root, '.git', 'test-done'), '');
      yield* Fiber.join(testing);
      yield* Deferred.await(retired);
      expect(yield* doors.atNative('read_changes', { limit: 10 }, actor)).toMatchObject({
        class: 'answer',
        value: {
          held: { paths: 0 },
          commits: expect.arrayContaining([expect.objectContaining({ sha: commit }), expect.objectContaining({ sha: sideCommit })]),
          turns: expect.arrayContaining([
            expect.objectContaining({ path: 'value.ts', state: 'committed', commit }),
            expect.objectContaining({ path: 'side.ts', state: 'committed', commit: sideCommit }),
          ]),
        },
      });
    }),
  );
});
