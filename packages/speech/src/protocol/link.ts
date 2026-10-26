import { type Cause, Clock, Effect, Queue, Result, type Scope, Semaphore, Stream } from 'effect';
import { Overflow, SpeechFailure } from '../wire/failure.ts';
import type { Keepalive } from './codec.ts';
import { type DuplexLink, type DuplexRequest, DuplexTransport, type Message } from './transport.ts';
import { forkWatched } from './watch.ts';

export type Step<State, Out> = {
  readonly state: State;
  readonly send: ReadonlyArray<Message>;
  readonly out: ReadonlyArray<Out>;
  readonly done: boolean;
};

export type Driving<State, Frame, Out> = {
  readonly request: DuplexRequest;
  readonly init: ReadonlyArray<Message>;
  readonly initial: State;
  readonly decode: (message: Message) => Result.Result<Frame, SpeechFailure>;
  readonly step: (state: State, frame: Frame) => Result.Result<Step<State, Out>, SpeechFailure>;
  readonly ready: (state: State) => boolean;
  readonly keepalive?: Keepalive | undefined;
  readonly readyMs: number;
  readonly bytesPerWeight: number;
  readonly ended: SpeechFailure;
};

export type Link<State, Out> = {
  readonly out: Stream.Stream<Out, SpeechFailure>;
  readonly act: (step: Acting<State, Out>, last?: boolean) => Effect.Effect<void, SpeechFailure>;
  readonly admit: (weight: number, limit: number, step: Acting<State, Out>) => Effect.Effect<void, SpeechFailure | Overflow>;
  readonly accepted: () => number;
  readonly delivered: Effect.Effect<number>;
};

export type Acting<State, Out> = (state: State) => Result.Result<Step<State, Out>, SpeechFailure>;

type Entry<State, Out> = { readonly step: Acting<State, Out>; readonly weight: number };

const sizeOf = (message: Message): number => (typeof message === 'string' ? message.length : message.byteLength);

export const drive = Effect.fnUntraced(function* <State, Frame, Out>(
  driving: Driving<State, Frame, Out>,
): Effect.fn.Return<Link<State, Out>, never, Scope.Scope | DuplexTransport> {
  const transport = yield* DuplexTransport;
  const scope = yield* Effect.scope;
  const lock = yield* Semaphore.make(1);
  const out = yield* Queue.unbounded<Out, SpeechFailure | Cause.Done>();
  yield* Effect.addFinalizer(() => Queue.shutdown(out));
  const locked = lock.withPermits(1);
  let state = driving.initial;
  let link: DuplexLink | undefined;
  let live = false;
  let done = false;
  let last = false;
  let failure: SpeechFailure | undefined;
  let pending: Array<Entry<State, Out>> = [];
  let queued = 0;
  let accepted = 0;
  let bytesPerWeight = driving.bytesPerWeight;
  let lastSent = 0;

  const fail = Effect.fnUntraced(function* (reason: SpeechFailure) {
    if (failure !== undefined || done) return;
    failure = reason;
    yield* Queue.fail(out, reason);
  });

  const transmit = Effect.fnUntraced(function* (messages: ReadonlyArray<Message>, weight: number): Effect.fn.Return<boolean> {
    let bytes = 0;
    for (const message of messages) {
      if (link === undefined || failure !== undefined) return false;
      const sent = yield* Effect.result(link.send(message));
      if (Result.isFailure(sent)) {
        yield* fail(sent.failure);
        return false;
      }
      bytes += sizeOf(message);
    }
    if (messages.length === 0) return true;
    if (weight > 0) bytesPerWeight = Math.max(1, bytes / weight);
    lastSent = yield* Clock.currentTimeMillis;
    return true;
  });

  const apply = Effect.fnUntraced(function* (step: Step<State, Out>, weight: number): Effect.fn.Return<void> {
    state = step.state;
    if (step.out.length > 0) yield* Queue.offerAll(out, step.out);
    if (!(yield* transmit(step.send, weight))) return;
    if (step.done) {
      done = true;
      yield* Queue.end(out);
      if (link !== undefined) yield* link.close;
      return;
    }
    if (!live && link !== undefined && driving.ready(state)) {
      live = true;
      yield* flush;
    }
  });

  const perform = (step: Acting<State, Out>, weight: number): Effect.Effect<void> => {
    const stepped = step(state);
    return Result.isFailure(stepped) ? fail(stepped.failure) : apply(stepped.success, weight);
  };

  const flush: Effect.Effect<void> = Effect.gen(function* () {
    const entries = pending;
    pending = [];
    for (const entry of entries) {
      queued -= entry.weight;
      if (failure !== undefined || done) continue;
      yield* perform(entry.step, entry.weight);
    }
  });

  const handle = Effect.fnUntraced(function* (message: Message) {
    if (failure !== undefined || done) return;
    const frame = driving.decode(message);
    if (Result.isFailure(frame)) return yield* fail(frame.failure);
    const stepped = driving.step(state, frame.success);
    if (Result.isFailure(stepped)) return yield* fail(stepped.failure);
    yield* apply(stepped.success, 0);
  });

  const run = Effect.gen(function* () {
    const opened = yield* Effect.result(transport.open(driving.request));
    if (Result.isFailure(opened)) return yield* locked(fail(opened.failure));
    yield* locked(
      Effect.gen(function* () {
        link = opened.success;
        if (!(yield* transmit(driving.init, 0))) return;
        yield* apply({ state, send: [], out: [], done: false }, 0);
      }),
    );
    const read = yield* Effect.result(Stream.runForEach(opened.success.messages, (message) => locked(handle(message))));
    yield* locked(
      fail(Result.isFailure(read) ? read.failure : SpeechFailure.transport('the provider closed the connection before it finished')),
    );
  });
  yield* forkWatched(run, scope, out);

  const deadline = Effect.andThen(
    Effect.sleep(driving.readyMs),
    locked(Effect.suspend(() => (live || done ? Effect.void : fail(SpeechFailure.transport('the provider was not ready in time'))))),
  );
  yield* forkWatched(deadline, scope, out);

  const keepalive = driving.keepalive;
  if (keepalive !== undefined) {
    const beat = locked(
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        if (live && !done && !last && now - lastSent >= keepalive.everyMs) yield* transmit([keepalive.message], 0);
      }),
    );
    yield* forkWatched(Effect.forever(Effect.andThen(Effect.sleep(keepalive.everyMs), beat)), scope, out);
  }

  const refused = () => Effect.fail(failure ?? driving.ended);

  const act = (step: Acting<State, Out>, final = false): Effect.Effect<void, SpeechFailure> =>
    locked(
      Effect.gen(function* () {
        if (failure !== undefined || done || last) return yield* refused();
        if (final) last = true;
        if (!live) {
          pending.push({ step, weight: 0 });
          return;
        }
        yield* perform(step, 0);
        if (failure !== undefined) return yield* refused();
      }),
    );

  const admit = (weight: number, limit: number, step: Acting<State, Out>) =>
    locked(
      Effect.gen(function* () {
        if (failure !== undefined || done || last) return yield* refused();
        if (weight <= 0) return;
        if (!live) {
          if (queued + weight > limit) return yield* new Overflow({ budgetFrames: limit, pendingFrames: queued });
          pending.push({ step, weight });
          queued += weight;
          accepted += weight;
          return;
        }
        const inflight = link === undefined ? 0 : Math.ceil((yield* link.buffered) / bytesPerWeight);
        if (inflight + weight > limit) return yield* new Overflow({ budgetFrames: limit, pendingFrames: inflight });
        accepted += weight;
        yield* perform(step, weight);
        if (failure !== undefined) return yield* refused();
      }),
    );

  const delivered = Effect.gen(function* () {
    const buffered = link === undefined ? 0 : yield* link.buffered;
    return Math.max(0, accepted - queued - Math.ceil(buffered / bytesPerWeight));
  });

  const driven: Link<State, Out> = {
    out: Stream.fromQueue(out),
    act,
    admit,
    accepted: () => accepted,
    delivered,
  };
  return driven;
});
