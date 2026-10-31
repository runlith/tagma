import { declare } from '@runlith/held/Held';
import { Deferred, Effect, Ref, Schema } from 'effect';
import { WireLost, WireFailed } from './Executions';
import { RequestId, type Request, type HostAnswer, type WireFault } from './protocol/wire';

const readRequestId = Schema.decodeUnknownSync(RequestId);

export type Lane = 'control' | 'walk';

const LANES: Record<Request['_tag'], Lane> = {
  Input: 'control',
  OpenTerminalLane: 'control',
  Signal: 'control',
  Custody: 'control',
  Authority: 'control',
  Stop: 'control',
  CancelStart: 'control',
  PreventStop: 'control',
  Retire: 'control',
  Shutdown: 'control',
  Quiesce: 'control',
  Resume: 'control',
  Prepare: 'control',
  Yield: 'control',
  Start: 'control',
  Revise: 'control',
  Pace: 'control',
  Disown: 'control',
  LoadInterest: 'control',
  LoadParts: 'control',
  EndResidual: 'control',
  EndProcess: 'control',
  Status: 'walk',
  List: 'walk',
  Changes: 'walk',
  State: 'walk',
  Ending: 'walk',
  Retained: 'walk',
  Command: 'walk',
  Commands: 'walk',
  CommandsAt: 'walk',
  Operation: 'walk',
  CallResult: 'walk',
  Read: 'walk',
  Subscribe: 'walk',
  Screen: 'walk',
  ScreenPoint: 'walk',
  Processes: 'walk',
  Foreground: 'walk',
  Listeners: 'walk',
  ListenerInventory: 'walk',
};

export const laneOf = (tag: Request['_tag']): Lane => LANES[tag];

export type Answer = {
  readonly request: RequestId;
  readonly response: HostAnswer;
  readonly payload: Uint8Array;
};

type Waiter = { readonly lane: Lane; readonly waiter: Deferred.Deferred<Answer, WireLost | WireFailed> };

export type WireRequests = {
  readonly ask: <E>(
    send: (request: RequestId) => Effect.Effect<void, E>,
    withdraw: (request: RequestId) => Effect.Effect<void>,
    lane: Lane,
  ) => Effect.Effect<Answer, E | WireLost | WireFailed>;
  readonly settle: (request: RequestId, response: HostAnswer, payload: Uint8Array) => Effect.Effect<void>;
  readonly fault: (request: RequestId, fault: WireFault) => Effect.Effect<void>;
  readonly closeAll: (reason: string) => Effect.Effect<void>;
  readonly waiting: (lane: Lane) => Effect.Effect<number>;
};

const split = (limit: number, control: number): { readonly control: number; readonly walk: number } => {
  if (control <= 0 || limit <= 1) return { control: 0, walk: limit };
  const held = Math.max(1, Math.min(control, limit - 1));
  return { control: held, walk: limit - held };
};

const depthOf = (waiters: ReadonlyMap<RequestId, Waiter>, lane: Lane): number => {
  let depth = 0;
  for (const held of waiters.values()) if (held.lane === lane) depth += 1;
  return depth;
};

export const wireRequests = Effect.fnUntraced(function* (limit: number, control: number): Effect.fn.Return<WireRequests> {
  const lanes = split(limit, control);
  const slotsOf = (lane: Lane, concurrency: number) =>
    declare<string>({
      name: `executions/wire-${lane}-slots`,
      owner: 'executions',
      rank: 800,
      key: (key) => key,
      concurrency,
      threshold: '10 seconds',
      ceilings: { hold: '15 minutes', wait: '10 minutes', leaves: 'the request was never sent; it may be asked again' },
      external: { named: 'execution host', callsBack: false },
    });
  const controlSlots = lanes.control === 0 ? undefined : slotsOf('control', lanes.control);
  const walkSlots = slotsOf('walk', lanes.walk);
  const poolFor = (lane: Lane) => (lane === 'control' ? (controlSlots ?? walkSlots) : walkSlots);
  const table = yield* Ref.make<ReadonlyMap<RequestId, Waiter>>(new Map());
  const numbering = yield* Ref.make(0);

  const forget = (request: RequestId) =>
    Ref.update(table, (waiters) => {
      if (!waiters.has(request)) return waiters;
      const kept = new Map(waiters);
      kept.delete(request);
      return kept;
    });

  const answer = (request: RequestId, outcome: Effect.Effect<Answer, WireLost | WireFailed>) =>
    Effect.flatMap(Ref.get(table), (waiters) => {
      const held = waiters.get(request);
      return held === undefined ? Effect.void : Effect.asVoid(Deferred.into(outcome, held.waiter));
    });

  return {
    ask: (send, withdraw, lane) =>
      Effect.withSpan(
        Effect.scoped(
          Effect.uninterruptibleMask((restore) =>
            Effect.gen(function* () {
              const pool = poolFor(lane);
              const depth = yield* Effect.map(Ref.get(table), (waiters) => waiters.size + 1);
              yield* restore(
                Effect.withSpan(
                  pool
                    .lease('slots')
                    .pipe(
                      Effect.mapError((stalled) => new WireLost({ reason: `no request slot came free (${stalled._tag})`, sent: false })),
                    ),
                  'wire.request.slot',
                  { attributes: { lane, depth } },
                ),
              );
              const request = readRequestId(yield* Ref.updateAndGet(numbering, (held) => held + 1));
              const waiter = yield* Deferred.make<Answer, WireLost | WireFailed>();
              yield* Ref.update(table, (waiters) => new Map(waiters).set(request, { lane, waiter }));
              return yield* restore(
                send(request).pipe(
                  Effect.andThen(Deferred.await(waiter)),
                  Effect.onInterrupt(() => Effect.ignore(withdraw(request))),
                  Effect.ensuring(forget(request)),
                ),
              );
            }),
          ),
        ),
        'wire.request.roundtrip',
        { attributes: { lane } },
      ),

    settle: (request, response, payload) => answer(request, Effect.succeed({ request, response, payload })),

    fault: (request, fault) => answer(request, Effect.fail(new WireFailed({ fault }))),

    closeAll: Effect.fnUntraced(function* (reason) {
      const waiters = yield* Ref.getAndSet(table, new Map<RequestId, Waiter>());
      for (const held of waiters.values()) {
        yield* Deferred.fail(held.waiter, new WireLost({ reason, sent: true }));
      }
    }),

    waiting: (lane) => Effect.map(Ref.get(table), (waiters) => depthOf(waiters, lane)),
  };
});
