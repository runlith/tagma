import { describe, expect } from 'bun:test';
import type { Tester } from '@runlith/effect-test';
import { Effect, type Scope } from 'effect';
import { modelCatalog } from '@runlith/llm/models/catalog';
import { DEFAULT_PROVIDER_DESCRIPTIONS } from '@runlith/builtin-catalog/descriptions';
import type { ThreadToolEntry } from '../../transcript/entries';
import { coreEntry } from '../../transcript/kinds';
import { OWNER, hold, opened, quiet, started, transcriptOf, until } from './compactionWorld';
import { planned, spawnedChild } from './compactionRequests/support';
import type { ThreadStorageFactory } from './storagePort';
const shipped = modelCatalog(DEFAULT_PROVIDER_DESCRIPTIONS).options.filter((option) => !option.operatorOnly);
export function describeThreadModelSettings<TTx, TWrite extends TTx = TTx, R = never>(
  name: string,
  open: ThreadStorageFactory<TTx, TWrite, R>,
  test: Tester<Scope.Scope | R>,
): void {
  describe(`${name}: one writer of a thread's model`, () => {
    test(
      'an operator move saves the next model and an agent move continues live work at a step boundary',
      Effect.fnUntraced(function* () {
        const stack = yield* opened(open, { collaboration: true });
        const working = hold();
        stack.world.tool = working;
        const childId = yield* spawnedChild(stack, { tool: 'work' }, { text: 'Done.' });
        yield* working.reached;
        const child = stack.world.harness.threads.handle(childId, OWNER);
        const before = (yield* stack.world.harness.reads.snapshot(childId)).thread.model;
        const [chosen, agents] = shipped.filter((option) => option.id !== before);
        if (chosen === undefined || agents === undefined)
          return yield* Effect.die('The shipped catalog offers no two models besides the default.');
        expect(chosen.id).not.toBe(before);
        const moved = yield* child.setModelSettings({
          provider: chosen.provider,
          model: chosen.id,
          reasoning: chosen.defaultReasoning ?? null,
          switches: {},
        });
        expect(moved.thread).toMatchObject({ provider: chosen.provider, model: chosen.id });
        planned(
          stack,
          stack.threadId,
          { call: 'set_agent_model', input: { threadId: childId, model: agents.id } },
          { text: 'Noted.' },
          { text: 'Read.' },
        );
        const parentRun = yield* started(stack.handle, 'Move the child.');
        yield* until(() =>
          Effect.map(transcriptOf(stack.storage, stack.threadId), (entries) => {
            const call = entries.find(
              (entry): entry is ThreadToolEntry & typeof entry =>
                coreEntry(entry) && entry.type === 'tool' && entry.toolName === 'set_agent_model' && entry.runId === parentRun,
            );
            return call?.execution?.state === 'started' || call?.toolError !== undefined || call?.toolOutput !== undefined;
          }),
        );
        expect((yield* stack.world.harness.reads.snapshot(childId)).thread.model).toBe(chosen.id);
        stack.world.tool = null;
        working.release();
        yield* quiet(stack.world, childId);
        yield* quiet(stack.world, stack.threadId);
        expect(stack.world.models.get(childId)).toEqual([before, agents.id]);
        expect((yield* stack.world.harness.reads.snapshot(childId)).thread.model).toBe(agents.id);

        const entries = yield* transcriptOf(stack.storage, childId);
        const opening = (entry: (typeof entries)[number]) =>
          (entry.type === 'message' && 'role' in entry && entry.role === 'user') ||
          (entry.type === 'signal' && 'signalType' in entry && entry.signalType === 'task');
        expect(entries.filter(opening)).toMatchObject([{ type: 'signal', signalType: 'task', senderThreadId: stack.threadId }]);
        expect(entries.filter((entry) => entry.type === 'tool')).toMatchObject([{ toolState: 'output-available' }]);
      }),
    );
    test(
      'a foreground model move of the calling run refuses without waiting for itself',
      Effect.fnUntraced(function* () {
        const stack = yield* opened(open, { collaboration: true });
        const before = (yield* stack.world.harness.reads.snapshot(stack.threadId)).thread.model;
        const chosen = shipped.find((model) => model.id !== before)!;
        planned(
          stack,
          stack.threadId,
          { call: 'set_agent_model', input: { threadId: stack.threadId, model: chosen.id } },
          { text: 'Refused.' },
        );
        yield* started(stack.handle, 'Move this run.');
        yield* quiet(stack.world, stack.threadId);
        expect((yield* transcriptOf(stack.storage, stack.threadId)).filter((entry) => entry.type === 'tool')).toMatchObject([
          { toolState: 'output-refused', toolRefusal: { code: 'self-move' } },
        ]);
        expect((yield* stack.world.harness.reads.snapshot(stack.threadId)).thread.model).toBe(before);
      }),
    );
    test(
      'an operator stop while a model move waits keeps the child stopped',
      Effect.fnUntraced(function* () {
        const stack = yield* opened(open, { collaboration: true });
        const working = hold();
        stack.world.tool = working;
        const childId = yield* spawnedChild(stack, { tool: 'work' }, { text: 'Done.' });
        yield* working.reached;
        const child = stack.world.harness.threads.handle(childId, OWNER);
        const before = (yield* stack.world.harness.reads.snapshot(childId)).thread.model;
        const chosen = shipped.find((model) => model.id !== before)!;
        planned(stack, stack.threadId, { call: 'set_agent_model', input: { threadId: childId, model: chosen.id } }, { text: 'Moved.' });
        const parentRun = yield* started(stack.handle, 'Move it.');
        yield* until(() =>
          Effect.map(transcriptOf(stack.storage, stack.threadId), (entries) =>
            entries.some(
              (entry) => entry.type === 'tool' && 'execution' in entry && entry.runId === parentRun && entry.execution?.state === 'started',
            ),
          ),
        );
        yield* child.stop();
        working.release();
        yield* quiet(stack.world, childId);
        yield* quiet(stack.world, stack.threadId);
        const state = yield* stack.world.harness.reads.snapshot(childId);
        expect(state.activeRun).toBeNull();
        expect(state.latestRun?.settledBy).toBe('reader');
        expect(state.thread.model).toBe(chosen.id);
        expect(stack.world.models.get(childId)).toEqual([before]);
      }),
    );
    test(
      'a model move over natural completion wakes the queued next task',
      Effect.fnUntraced(function* () {
        const stack = yield* opened(open, { collaboration: true });
        const finishing = hold();
        const childId = yield* spawnedChild(stack, { text: 'Done.', held: finishing });
        yield* finishing.reached;
        const child = stack.world.harness.threads.handle(childId, OWNER);
        const before = (yield* stack.world.harness.reads.snapshot(childId)).thread.model;
        const chosen = shipped.find((model) => model.id !== before)!;
        planned(
          stack,
          stack.threadId,
          { call: 'set_agent_model', input: { threadId: childId, model: chosen.id } },
          { text: 'Moved.' },
          { text: 'Read.' },
        );
        planned(stack, childId, { text: 'Next task done.' });
        const parentRun = yield* started(stack.handle, 'Move it.');
        yield* until(() =>
          Effect.map(transcriptOf(stack.storage, stack.threadId), (entries) =>
            entries.some(
              (entry) => entry.type === 'tool' && 'execution' in entry && entry.runId === parentRun && entry.execution?.state === 'started',
            ),
          ),
        );
        expect((yield* child.queue('The next task.')).status).toBe('queued');
        finishing.release();
        yield* until(() => Effect.sync(() => (stack.world.models.get(childId)?.length ?? 0) === 2));
        yield* quiet(stack.world, childId);
        yield* quiet(stack.world, stack.threadId);
        expect(stack.world.models.get(childId)).toEqual([before, chosen.id]);
        expect((yield* stack.world.harness.reads.snapshot(childId)).pendingInput.queued).toEqual([]);
      }),
    );
  });
}
