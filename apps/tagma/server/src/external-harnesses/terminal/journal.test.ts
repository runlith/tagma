import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Context, Deferred, Effect, Fiber, Layer } from 'effect';
import { activityRecording } from '@runlith/activity/testing';
import { openMemoryStorage, type MemoryStorage } from '@runlith/agent/thread/conformance/memoryStorage';
import { APPROVAL, lifecycleWorldOver, OWNER, SCOPE } from '@runlith/agent/thread/conformance/lifecycleWorld';
import { fakeAdapter } from '@runlith/agent/thread/conformance/fakeTransport';
import { ThreadInbox } from '../../threads/store/inbox.js';
import { harnessFacet } from '../../threads/contract/wire/harness/types.js';
import { harnessPresentation } from '../contract/service/table.js';
import { builtinHarness } from '../testing/builtin.js';
import { terminalKernel } from '../birth/seat.js';
import { RunActivities } from '../protocol/activities.js';
import { memorySessionRows } from '../testing/memorySessions.js';
import { TerminalJournal } from './journal.js';

it.effect('an observed run stopped before its afterCommit activity opens still records its committed cancellation', () =>
  Effect.gen(function* () {
    const storage = yield* openMemoryStorage();
    const reading = yield* Deferred.make<string>();
    const released = yield* Deferred.make<void>();
    let held = false;
    const controlled: MemoryStorage = {
      ...storage,
      runs: (options) => {
        const runs = storage.runs(options);
        return {
          ...runs,
          runById: Effect.fnUntraced(function* (...[id, unit]: Parameters<typeof runs.runById>) {
            if (held && unit === undefined) {
              held = false;
              yield* Deferred.succeed(reading, id);
              yield* Deferred.await(released);
            }
            return yield* runs.runById(id, unit);
          }),
        };
      },
    };
    const kernel = terminalKernel(builtinHarness('claude-code'), undefined, false, {});
    const thread = yield* storage.createThread({ ownerId: OWNER, scope: SCOPE, transport: kernel.transport });
    yield* storage.aggregate.update(thread.id, { capabilities: kernel.capabilities });
    const world = yield* lifecycleWorldOver(controlled, (yield* storage.aggregate.find(thread.id))!, undefined, fakeAdapter('terminal'));
    const memory = yield* memorySessionRows(storage);
    const recorded = activityRecording();
    const inbox = Context.get(yield* Layer.build(Layer.mock(ThreadInbox, { writes: memory.rows.writes })), ThreadInbox);
    const journal = new TerminalJournal(
      world.reports.of('terminal'),
      memory.rows.writes,
      new RunActivities(inbox, recorded.log, yield* Effect.scope),
      world.ledger,
    );
    yield* world.settlements.subscribe({ name: 'terminal run activity', at: 'first', handle: (event) => journal.settled(event) });
    held = true;
    const opening = yield* Effect.forkScoped(
      memory.rows.within('testing.observed', (unit) =>
        Effect.gen(function* () {
          const [observed] = yield* journal.apply(unit, [
            journal.reports.observed(thread.id, { displaces: null, approval: APPROVAL, entries: () => [] }, 'prompt:1'),
          ]);
          if (observed?.status !== 'applied') return yield* Effect.die('the observed start was not admitted');
          yield* unit.afterCommit(
            journal
              .open(
                { id: observed.runId, threadId: thread.id },
                harnessFacet('claude-code', harnessPresentation(builtinHarness('claude-code'))),
                [],
              )
              .pipe(Effect.orDie),
          );
        }),
      ),
    );
    const id = yield* Deferred.await(reading);
    expect(yield* world.lifecycle.stop({ id, threadId: thread.id }, { by: 'reader', marker: false, withdraw: false }, false)).toBe(
      'stopped',
    );
    yield* world.settled(1);
    yield* Deferred.succeed(released, undefined);
    yield* Fiber.join(opening);
    expect(recorded.activities()).toHaveLength(1);
    expect(recorded.activities()[0]?.ended).toMatchObject({ outcome: 'cancelled', reason: 'reader', result: { finish: 'aborted' } });
  }),
);
