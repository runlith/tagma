import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { Context, Deferred, Effect, Fiber, FileSystem, Layer, Queue, Stream } from 'effect';
import { THREAD_TOOL_CANCEL_VALUE } from '@runlith/agent/transcript/parts';
import { NativeStorage, ThreadHarness } from '../../../threads/contract/service/engine.js';
import { Message } from '@runlith/llm/schema/messages';
import { compactionIn } from '../threads/journalReads.js';
import { hostedRun, hostedThread, runnerWorld } from './runnerRig.js';

const setup = Effect.gen(function* () {
  const world = yield* runnerWorld();
  return { world, thread: yield* hostedThread(world, 'trust') };
});
class Hosted extends Context.Service<Hosted, Effect.Success<typeof setup>>()('testing/Hosted') {}
const fixture = Layer.effectContext(Effect.map(setup, (at) => Context.add(at.world.world.runtime.owners, Hosted, at))).pipe(
  Layer.provideMerge(BunFileSystem.layer),
);
const hosting = Effect.map(Hosted, ({ world }) => Context.get(world.world.runtime.owners, ThreadHarness).runs.hosting());
const call = (input: ReturnType<typeof append>) => Effect.flatMap(hosting, (door) => door.call(input));
const history = Effect.gen(function* () {
  const { world, thread } = yield* Hosted;
  return (yield* compactionIn(world.world.runtime.owners, thread, null)).history;
});
const append = (threadId: string, toolCallId: string, target: string) => {
  const input = { command: `printf x >> ${target}`, description: 'Append one x' };
  return { threadId, agentId: 'tagma', toolCallId, name: 'bash', input, arguments: JSON.stringify(input) };
};

layer(fixture, { excludeTestServices: true })('hosted native calls', (it) => {
  it.effect('hosted calls keep their recorded result and foreign mutations wait for delivered law', () =>
    Effect.gen(function* () {
      const { world, thread } = yield* Hosted;
      const files = yield* FileSystem.FileSystem;
      const target = join(world.root, 'once.txt');
      const appended = append(thread, 'toolu_once', target);
      yield* hostedRun(
        world,
        thread,
        crypto.randomUUID(),
        Effect.gen(function* () {
          const [first, second] = yield* Effect.all([call(appended), call(appended)], { concurrency: 2 });
          const recorded = yield* history;
          const third = yield* call(appended);
          expect(first).toEqual(second);
          expect(third).toEqual(first);
          expect(first).toMatchObject({ failed: false });
          expect(yield* history).toBe(recorded);
          const foreign = yield* world.world.checkout();
          const foreignTarget = join(foreign.root, 'under-law.txt');
          const foreignCall = append(thread, 'toolu_law_first', foreignTarget);
          const input = { ...foreignCall.input, workdir: foreign.root };
          const callAt = (toolCallId: string) => call({ ...foreignCall, toolCallId, input, arguments: JSON.stringify(input) });
          const storage = Context.get(world.world.runtime.owners, NativeStorage);
          const row = yield* storage.threads.metadata(thread);
          if (row === undefined) return yield* Effect.die('the hosted thread disappeared');
          const transports = Context.get(world.world.runtime.owners, ThreadHarness).runs.transports();
          const transport = yield* transports.of(row);
          const reaching = yield* Deferred.make<void>();
          const printed = yield* Deferred.make<void>();
          yield* transports.register({
            ...transport,
            adapter: 'place-law-race',
            runs: {
              ...transport.runs,
              reached: (run, mark) =>
                mark !== 'all' && mark.callId === 'toolu_law_first'
                  ? Effect.andThen(Deferred.succeed(reaching, undefined), Deferred.await(printed))
                  : transport.runs.reached(run, mark),
            },
          });
          yield* Effect.acquireRelease(storage.threads.update(thread, { transport: { ...row.transport, adapter: 'place-law-race' } }), () =>
            Effect.orDie(storage.threads.update(thread, { transport: row.transport })),
          );
          const answering = yield* Effect.forkScoped(callAt('toolu_law_first'));
          yield* Deferred.await(reaching);
          yield* storage.threads.appendEntries(thread, {
            history: [
              Message.assistant([
                { type: 'tool-call', id: 'toolu_law_first', name: 'bash', input },
                { type: 'tool-call', id: 'toolu_law_sibling', name: 'bash', input },
              ]),
            ],
          });
          yield* Deferred.succeed(printed, undefined);
          const refused = yield* Fiber.join(answering);
          expect(refused).toMatchObject({ failed: true });
          expect(JSON.stringify(refused.output)).toContain('instructions-unread');
          expect(yield* files.exists(foreignTarget)).toBe(false);
          expect(refused.guides.length).toBeGreaterThan(0);
          const sibling = yield* callAt('toolu_law_sibling');
          expect(sibling).toMatchObject({ failed: true });
          expect(JSON.stringify(sibling.output)).toContain('instructions-unread');
          expect(yield* files.exists(foreignTarget)).toBe(false);
          const permitted = yield* callAt('toolu_law_next');
          expect(permitted).toMatchObject({ failed: false });
          expect(yield* files.readFileString(foreignTarget)).toBe('x');
          yield* storage.threads.appendEntries(thread, {
            history: [
              new Message({
                role: 'user',
                content: [{ type: 'text', text: 'Summary.' }],
                compaction: { id: 'hosted-law-reset', mode: 'manual', transcriptLocation: world.root, preservedCount: 0 },
              }),
            ],
          });
          const reset = yield* callAt('toolu_law_reset');
          expect(reset).toMatchObject({ failed: true });
          expect(JSON.stringify(reset.output)).toContain('instructions-unread');
          expect(yield* files.readFileString(foreignTarget)).toBe('x');
        }),
      );
      expect(yield* files.readFileString(target)).toBe('x');
    }),
  );

  it.effect('a fresh host freezes its preview and rebuilt hosts replay recorded calls without performing them', () =>
    Effect.gen(function* () {
      const { world } = yield* Hosted;
      const files = yield* FileSystem.FileSystem;
      const thread = yield* hostedThread(world, 'trust');
      const door = yield* hosting;
      const read = yield* door.agent(thread, 'tagma');
      const target = join(world.root, 'recovered.txt');
      const appended = append(thread, 'toolu_recovered', target);
      const refused = { ...appended, toolCallId: 'toolu_refused', name: 'no_such_tool' };
      const work = Effect.all([call(appended), call(refused)]);
      const first = yield* hostedRun(
        world,
        thread,
        crypto.randomUUID(),
        Effect.gen(function* () {
          const opened = yield* door.open(thread, 'tagma');
          expect(opened.prompt).toBe(read.prompt);
          return yield* work;
        }),
      );
      expect((yield* door.agent(thread, 'tagma')).prompt).toBe(read.prompt);
      const again = yield* hostedRun(world, thread, crypto.randomUUID(), work);
      expect(again).toEqual(first);
      expect(first[1]).toMatchObject({ failed: true });
      expect(yield* files.readFileString(target)).toBe('x');
    }),
  );

  it.effect('a call the reader cancelled is answered as cancelled again by a host built after it, and never runs', () =>
    Effect.gen(function* () {
      const { world } = yield* Hosted;
      const files = yield* FileSystem.FileSystem;
      const harness = Context.get(world.world.runtime.owners, ThreadHarness);
      const door = harness.runs.hosting();
      const reviewed = yield* hostedThread(world, 'review');
      const target = join(world.root, 'cancelled.txt');
      const appended = append(reviewed, 'toolu_cancelled', target);
      const first = yield* hostedRun(
        world,
        reviewed,
        crypto.randomUUID(),
        Effect.gen(function* () {
          const changed = yield* Effect.acquireRelease(Queue.unbounded<void>(), Queue.shutdown);
          yield* Effect.acquireRelease(
            Effect.sync(() =>
              harness.reads.subscribe(reviewed, () => {
                Queue.offerUnsafe(changed, undefined);
              }),
            ),
            (unsubscribe) => Effect.sync(unsubscribe),
          );
          const answering = yield* Effect.forkScoped(call(appended));
          yield* Stream.fromQueue(changed).pipe(
            Stream.mapEffect(() => door.holds(reviewed, appended.toolCallId)),
            Stream.filter(Boolean),
            Stream.runHead,
          );
          yield* door.answer(reviewed, appended.toolCallId, [{ questionId: appended.toolCallId, values: [THREAD_TOOL_CANCEL_VALUE] }]);
          return yield* Fiber.join(answering);
        }),
      );
      const again = yield* hostedRun(world, reviewed, crypto.randomUUID(), call(appended));
      expect(first).toMatchObject({ failed: true });
      expect(again).toEqual(first);
      expect(yield* files.exists(target)).toBe(false);
    }),
  );
});
