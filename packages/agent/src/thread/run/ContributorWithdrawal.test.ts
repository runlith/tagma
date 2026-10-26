import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Deferred, Effect, Fiber } from 'effect';
import { Message } from '@runlith/llm/schema/messages';
import { threadToolSources } from '../ThreadPorts';
import { openMemoryStorage } from '../conformance/memoryStorage';
import { hosted } from '../conformance/hostedCalls';
import { openedRun, OWNER, pump, startedTurn } from '../conformance/runLog/world';
import { replyTurn, scriptedStep } from '../conformance/runLog/scripts';
import { selectingCatalog, confirmingTurn, toolResultIds } from '../conformance/runLog/toolScripts';

it.live('removing a contributor closes its approval and resumes the native run without executing a replacement', () =>
  Effect.gen(function* () {
    const registry = threadToolSources();
    const selector = { names: ['thread-a'], read: [] as readonly string[] };
    const catalog = selectingCatalog(selector);
    const source = {
      id: 'notes',
      owner: 'plugin',
      names: ['read_selection'],
      offer: () => Effect.succeed({ id: 'notes', tools: catalog }),
    };
    const dispose = yield* registry.register(source);
    const settled = yield* Deferred.make<void>();
    const { storage, world, thread } = yield* openedRun(openMemoryStorage, {
      catalog,
      onSettled: () => Effect.asVoid(Deferred.succeed(settled, undefined)),
    });
    const [offered] = yield* registry.offers({ thread, context: null });
    if (offered === undefined) return yield* Effect.die('Missing contribution');
    Object.assign(catalog, offered.tools);
    yield* world.harness.threads.handle(thread.id, OWNER).setAuthorityMode('review');
    world.plan.push(confirmingTurn(catalog));
    yield* pump(yield* startedTurn(world, thread.id, 'Read the selection.'));
    expect((yield* world.harness.reads.snapshot(thread.id)).activeRun?.progress.stage).toBe('awaiting-question');
    world.plan.push(
      replyTurn({
        chunks: [],
        steps: [scriptedStep({ text: 'Continued.', messages: [Message.assistant('Continued.')] })],
      }),
    );
    dispose();
    yield* registry.register(source);
    yield* Deferred.await(settled);
    const row = yield* storage.aggregate.find(thread.id);
    expect(row?.status).toBe('idle');
    const transcript = (yield* storage.aggregate.transcriptOf(thread.id)) ?? [];
    expect(row?.pendingInteraction).toBeNull();
    expect(selector.read).toEqual([]);
    expect(toolResultIds(row?.history ?? [])).toEqual(['call-1']);
    expect(transcript.filter((entry) => entry.type === 'tool')).toMatchObject([
      {
        toolCallId: 'call-1',
        toolState: 'output-refused',
        toolRefusal: { code: 'contributor-absent' },
        toolOutput: { status: 'refused', code: 'contributor-absent' },
      },
    ]);
    expect(transcript.filter((entry) => entry.type === 'question')).toMatchObject([{ status: 'cleared' }]);
  }),
);

it.live('removing a contributor closes its hosted approval and refuses a repeated call without executing a replacement', () =>
  Effect.gen(function* () {
    const registry = threadToolSources();
    const selector = { names: ['thread-a'], read: [] as readonly string[] };
    const catalog = selectingCatalog(selector);
    const source = {
      id: 'notes',
      owner: 'plugin',
      names: ['read_selection'],
      offer: () => Effect.succeed({ id: 'notes', tools: catalog }),
    };
    const dispose = yield* registry.register(source);
    const run = yield* hosted(openMemoryStorage, catalog);
    const [offered] = yield* registry.offers({ thread: run.thread, context: null });
    if (offered === undefined) return yield* Effect.die('Missing contribution');
    Object.assign(catalog, offered.tools);
    yield* run.world.harness.threads.handle(run.thread.id, OWNER).setAuthorityMode('review');
    yield* run.world.harness.runs.hosting().open(run.thread.id, run.thread.agentId);
    const call = () => run.call('call-1', 'read_selection', { of: 'root-1' });
    const awaiting = yield* Deferred.make<void>();
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        run.world.harness.reads.subscribeStates((state) => {
          if (state.thread.id === run.thread.id && state.activeRun?.progress.stage === 'awaiting-question') {
            Deferred.doneUnsafe(awaiting, Effect.void);
          }
        }),
      ),
      (stop) => Effect.sync(stop),
    );
    const pending = yield* Effect.forkScoped(call());
    yield* Deferred.await(awaiting);
    expect((yield* run.world.harness.reads.snapshot(run.thread.id)).activeRun?.progress.stage).toBe('awaiting-question');
    dispose();
    yield* registry.register(source);
    expect(structuredClone(yield* Fiber.join(pending))).toMatchObject({
      failed: true,
      output: { type: 'text', value: expect.stringContaining('refused[contributor-absent]:') },
    });
    expect((yield* run.world.harness.reads.snapshot(run.thread.id)).activeRun?.progress.stage).toBe('running');
    expect(yield* run.questions()).toMatchObject([{ status: 'cleared' }]);
    expect(yield* run.entry('call-1')).toMatchObject({
      toolState: 'output-refused',
      toolOutput: { code: 'contributor-absent' },
      toolRefusal: { code: 'contributor-absent' },
    });
    expect(yield* call()).toMatchObject({
      failed: true,
      output: { type: 'text', value: expect.stringContaining('refused[contributor-absent]:') },
    });
    expect(selector.read).toEqual([]);
  }),
);
