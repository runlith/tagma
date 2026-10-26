import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Deferred, Effect, type Exit, Fiber, Option, Tracer } from 'effect';
import * as Hex from 'effect/encoding/Hex';
import type { RequestId } from './protocol/wire';
import { EMPTY_PAYLOAD } from './protocol/frames';
import { type Lane, type WireRequests, wireRequests } from './WireRequests';

type Recorded = {
  readonly spanId: string;
  readonly traceId: string;
  readonly parentId: string | undefined;
  readonly name: string;
  readonly attributes: Map<string, unknown>;
  exit: Exit.Exit<unknown, unknown> | undefined;
};

const collected = () => {
  const spans: Array<Recorded> = [];
  const tracer = Tracer.make({
    span(options) {
      const parent = Option.getOrUndefined(options.parent);
      const spanId = Hex.random(16);
      const record: Recorded = {
        spanId,
        traceId: parent?.traceId ?? Hex.random(32),
        parentId: parent?.spanId,
        name: options.name,
        attributes: new Map(),
        exit: undefined,
      };
      spans.push(record);
      return {
        _tag: 'Span',
        spanId,
        traceId: record.traceId,
        name: options.name,
        parent: options.parent,
        annotations: options.annotations,
        attributes: record.attributes,
        links: options.links,
        sampled: options.sampled,
        kind: options.kind,
        status: { _tag: 'Started', startTime: options.startTime },
        attribute(key: string, value: unknown) {
          record.attributes.set(key, value);
        },
        event() {},
        addLinks() {},
        end(_endTime: bigint, exit: Exit.Exit<unknown, unknown>) {
          record.exit = exit;
        },
      };
    },
  });
  return { tracer, spans };
};

const asking = Effect.fnUntraced(function* (requests: WireRequests, lane: Lane) {
  const sent = yield* Deferred.make<RequestId>();
  const fiber = yield* Effect.forkScoped(
    requests.ask(
      (request) => Effect.asVoid(Deferred.succeed(sent, request)),
      () => Effect.void,
      lane,
    ),
  );
  return { fiber, sent };
});

describe('an ask waits in its lane', () => {
  it.effect('a full table parks the next ask, and the ask that stops waiting gives nothing away', () => {
    const { tracer, spans } = collected();
    return Effect.gen(function* () {
      const requests = yield* wireRequests(1, 0);
      const holding = yield* asking(requests, 'control');
      const held = yield* Deferred.await(holding.sent);
      const inFlight = yield* requests.waiting('control');

      const waiting = yield* asking(requests, 'walk');
      yield* Effect.yieldNow;
      const parked = yield* requests.waiting('walk');
      yield* Fiber.interrupt(waiting.fiber);
      const afterInterrupt = yield* requests.waiting('control');

      yield* requests.closeAll('the case ends');
      yield* Fiber.await(holding.fiber);
      const next = yield* asking(requests, 'control');
      const sent = yield* Deferred.await(next.sent);
      const afterRelease = yield* requests.waiting('control');
      yield* Fiber.interrupt(next.fiber);

      expect(inFlight).toBe(1);
      expect(parked).toBe(0);
      expect(afterInterrupt).toBe(1);
      expect(yield* Deferred.isDone(waiting.sent)).toBe(false);
      expect(Number(sent)).toBe(Number(held) + 1);
      expect(afterRelease).toBe(1);

      const slots = spans.filter((span) => span.name === 'wire.request.slot');
      const roundtrips = spans.filter((span) => span.name === 'wire.request.roundtrip');
      expect(slots).toHaveLength(3);
      expect(roundtrips).toHaveLength(3);
      for (const slot of slots) {
        const parent = roundtrips.find((span) => span.spanId === slot.parentId);
        expect(parent?.traceId).toBe(slot.traceId);
        expect(typeof slot.attributes.get('depth')).toBe('number');
      }
      expect(slots.map((slot) => slot.attributes.get('lane'))).toEqual(['control', 'walk', 'control']);

      const interrupted = slots.filter((slot) => slot.exit?._tag === 'Failure');
      expect(interrupted).toHaveLength(1);
      expect(interrupted[0]?.attributes.get('depth')).toBe(2);
      expect(interrupted[0]?.attributes.get('lane')).toBe('walk');
    }).pipe(Effect.withTracer(tracer));
  });

  it.effect('a walk holding its own lane never delays a control ask, and the ceiling still bounds both', () =>
    Effect.gen(function* () {
      const requests = yield* wireRequests(6, 2);
      const rows = [];
      for (let row = 0; row < 5; row += 1) {
        const askingWalk = yield* asking(requests, 'walk');
        rows.push(askingWalk);
        if (row < 4) yield* Deferred.await(askingWalk.sent);
      }

      const typing = yield* asking(requests, 'control');
      yield* Deferred.await(typing.sent);
      const lanes = { walk: yield* requests.waiting('walk'), control: yield* requests.waiting('control') };

      const second = yield* asking(requests, 'control');
      yield* Deferred.await(second.sent);
      const third = yield* asking(requests, 'control');
      yield* Effect.yieldNow;
      const thirdWaited = !(yield* Deferred.isDone(third.sent));
      yield* Fiber.interrupt(third.fiber);

      let answered = 0;
      for (const row of rows) {
        yield* requests.settle(yield* Deferred.await(row.sent), { _tag: 'State' }, EMPTY_PAYLOAD);
        const exit = yield* Fiber.await(row.fiber);
        if (exit._tag === 'Success') answered += 1;
      }
      expect(lanes).toEqual({ walk: 4, control: 1 });
      expect(thirdWaited).toBe(true);
      expect(answered).toBe(5);
    }),
  );
});
