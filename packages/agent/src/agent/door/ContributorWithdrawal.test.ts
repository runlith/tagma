import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Deferred, Effect, Fiber, Schema } from 'effect';
import { Tool } from '../tool';
import { call, countingTool, open, verdict, WRITES_ONE_FILE } from './testing/open';
import { ASKS_NEVER } from '../../permissions/vocabulary';
const contributed = <T extends Tool>(
  tool: T,
  registered: {
    standing: boolean;
  },
): T => ({
  ...tool,
  contributor: { id: 'notes', standing: () => registered.standing },
});
describe('a call whose source was withdrawn', () => {
  it.effect(
    'is refused before admission or after the reader’s word, without executing',
    Effect.fnUntraced(function* () {
      let runs = 0;
      const registered = { standing: false };
      const tool = contributed(
        countingTool(() => {
          runs += 1;
        }),
        registered,
      );
      const { door } = open();
      expect(yield* verdict(door, call(tool))).toMatchObject({ verdict: 'deny', code: 'contributor-absent' });
      const outcome = yield* door.settle(call(tool));
      expect(runs).toBe(0);
      expect(outcome.executed).toBe(false);
      expect(outcome.output).toMatchObject({ status: 'refused', code: 'contributor-absent' });
      registered.standing = true;
      const { door: asking } = open({ mode: 'review' });
      expect((yield* verdict(asking, call(tool, { declares: WRITES_ONE_FILE }))).verdict).toBe('ask');
      registered.standing = false;
      const withdrawn = yield* asking.settle(call(tool, { declares: WRITES_ONE_FILE, confirmed: true }));
      expect(runs).toBe(0);
      expect(withdrawn.output).toMatchObject({ status: 'refused', code: 'contributor-absent' });
    }),
  );
  it.effect(
    'parked for the reader’s word is refused on a rebuilt door even when a successor stands under the same id',
    Effect.fnUntraced(function* () {
      let runs = 0;
      const first = { standing: true };
      const asked = contributed(
        countingTool(() => {
          runs += 1;
        }),
        first,
      );
      const { door: parked } = open({ mode: 'review' });
      expect((yield* verdict(parked, call(asked, { declares: WRITES_ONE_FILE }))).verdict).toBe('ask');
      const resolutions = parked.resolutionsOf(['call-1']);
      first.standing = false;
      const successor = contributed(
        countingTool(() => {
          runs += 1;
        }),
        { standing: true },
      );
      const { door: rebuilt } = open({ mode: 'review', resolutions });
      const invocation = call(successor, { declares: WRITES_ONE_FILE, confirmed: true });
      const held = yield* rebuilt.approved({ name: invocation.name, tool: invocation.tool, input: invocation.input, toolCallId: 'call-1' });
      const outcome = yield* rebuilt.settle(invocation, held);
      expect(runs).toBe(0);
      expect(outcome.output).toMatchObject({ status: 'refused', code: 'contributor-absent' });
    }),
  );
  it.effect(
    'already running finishes with its own outcome',
    Effect.fnUntraced(function* () {
      const registered = { standing: true };
      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const tool = contributed(
        Tool.make({
          display: () => ({ form: 'none' }),
          approval: ASKS_NEVER,
          description: 'Waits, then answers.',
          parameters: Schema.Struct({}),
          execute: () => Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)), Effect.as({ ok: true })),
        }),
        registered,
      );
      const { door } = open();
      const running = yield* Effect.forkScoped(door.settle(call(tool)));
      yield* Deferred.await(entered);
      registered.standing = false;
      yield* Deferred.succeed(release, undefined);
      expect(yield* Fiber.join(running)).toMatchObject({ executed: true, output: { ok: true } });
    }),
  );
  it.effect(
    'repeated under a finished call id answers the recorded outcome without running again',
    Effect.fnUntraced(function* () {
      let runs = 0;
      const registered = { standing: true };
      const tool = contributed(
        countingTool(() => {
          runs += 1;
        }),
        registered,
      );
      const { door } = open();
      const first = yield* door.settle(call(tool, { toolCallId: 'call-9' }));
      registered.standing = false;
      const again = yield* door.settle(call(tool, { toolCallId: 'call-9' }));
      expect(runs).toBe(1);
      expect(again).toEqual(first);
    }),
  );
});
