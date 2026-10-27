/// <reference types="bun" />

import { Deferred, Duration, Effect, Exit, Fiber, Queue, Scope } from 'effect';
import { TRANSFER_LIMIT } from '@runlith/executions/protocol/capacity';
import type { ExecutionLimits } from '@runlith/executions/protocol/capacity';
import type { BindingId, Principal } from '@runlith/executions/protocol/custody';
import type { ExecutionRef } from '@runlith/executions/protocol/execution';
import type { InputAnswer, InputFrontier, InputRequest } from '@runlith/executions/protocol/input';
import type { LaneInput } from '@runlith/executions/protocol/lane';
import type { TerminalGeometry } from '@runlith/executions/protocol/record';
import type { Binding } from '../Bindings';
import {
  InputActUnsupported,
  InputWriteFailed,
  makeExecutionInput,
  type ExecutionInput,
  type InputCarry,
  type InputFenced,
  type InputOwed,
} from '../ExecutionInput';
import { ChannelFailed, type PendingEcho } from '../holder/Holder';
import { admittedInto, terminalSink, type AdmittedInputs } from '../TerminalInputs';
import { Descriptor } from './Descriptor';
import { makeLanes } from './lanes';
import { Descriptors } from './native';
import { Reactor } from './Reactor';

export const READ_AHEAD_BYTES = 16 * TRANSFER_LIMIT;

export type Failure = { readonly _tag: string; readonly [field: string]: unknown };

export type InputAsk =
  | { readonly _tag: 'Admit'; readonly request: InputRequest; readonly binding: Binding }
  | { readonly _tag: 'CloseIntake' }
  | { readonly _tag: 'Halt'; readonly withinMs: number }
  | { readonly _tag: 'Reply'; readonly bytes: Uint8Array; readonly settling: boolean }
  | { readonly _tag: 'EndLanes' }
  | { readonly _tag: 'CloseLane'; readonly binding: BindingId; readonly principal: Principal }
  | { readonly _tag: 'Next'; readonly binding: Binding }
  | { readonly _tag: 'OpenLane'; readonly binding: Binding }
  | { readonly _tag: 'EndLane'; readonly binding: BindingId }
  | { readonly _tag: 'Finish' }
  | { readonly _tag: 'Fence'; readonly reason: InputFenced['reason']; readonly detail: string }
  | { readonly _tag: 'Frontier' }
  | { readonly _tag: 'PendingBytes' }
  | { readonly _tag: 'PendingActs' }
  | { readonly _tag: 'Dispose' };

export type Ask =
  | { readonly _tag: 'Read'; readonly handle: number; readonly limit: number }
  | { readonly _tag: 'StopReading'; readonly handle: number }
  | { readonly _tag: 'Write'; readonly handle: number; readonly bytes: Uint8Array }
  | { readonly _tag: 'StopWriting'; readonly handle: number }
  | { readonly _tag: 'Resize'; readonly handle: number; readonly rows: number; readonly cols: number }
  | { readonly _tag: 'Size'; readonly handle: number }
  | { readonly _tag: 'Foreground'; readonly handle: number }
  | { readonly _tag: 'Facts'; readonly handle: number; readonly pid: number }
  | { readonly _tag: 'Interrupt'; readonly handle: number }
  | { readonly _tag: 'PendingEchoes'; readonly handle: number }
  | { readonly _tag: 'Owe'; readonly handle: number; readonly echoes: ReadonlyArray<PendingEcho> }
  | {
      readonly _tag: 'OpenInput';
      readonly handle: number;
      readonly limits: ExecutionLimits;
      readonly ref: ExecutionRef;
      readonly carried: InputCarry | undefined;
      readonly output: bigint;
    }
  | { readonly _tag: 'Input'; readonly handle: number; readonly ask: InputAsk };

export type Question = { readonly _tag: 'CloseInput' } | { readonly _tag: 'Resized'; readonly geometry: TerminalGeometry };

export type Request =
  | { readonly _tag: 'Open'; readonly path: string }
  | { readonly _tag: 'Shutdown' }
  | { readonly _tag: 'Adopt'; readonly handle: number; readonly fd: number }
  | { readonly _tag: 'Close'; readonly handle: number }
  | { readonly _tag: 'Ask'; readonly id: number; readonly ask: Ask }
  | { readonly _tag: 'Cancel'; readonly id: number }
  | { readonly _tag: 'Settled'; readonly id: number; readonly failure: Failure | undefined }
  | { readonly _tag: 'Taken'; readonly handle: number };

export type Answer =
  | { readonly _tag: 'Ready' }
  | { readonly _tag: 'Opened'; readonly interactive: string | undefined }
  | { readonly _tag: 'Closed' }
  | { readonly _tag: 'Refused'; readonly detail: string }
  | { readonly _tag: 'Answered'; readonly id: number; readonly value: unknown }
  | { readonly _tag: 'Failed'; readonly id: number; readonly failure: Failure }
  | { readonly _tag: 'Question'; readonly id: number; readonly handle: number; readonly question: Question }
  | { readonly _tag: 'Announce'; readonly handle: number }
  | { readonly _tag: 'Admitted'; readonly handle: number; readonly inputs: ReadonlyArray<LaneInput> }
  | { readonly _tag: 'Room'; readonly handle: number; readonly room: number };

export type ReplyAnswered =
  | { readonly _tag: 'ReplyQueued'; readonly acceptedThrough: InputFrontier['acceptedThrough'] }
  | { readonly _tag: 'ReplyBackpressure'; readonly pendingBytes: number; readonly limit: number; readonly room: number | undefined }
  | { readonly _tag: 'ReplyEnded' };

declare const self: Worker;

const send = (answer: Answer): void => self.postMessage(answer);

const projected = (failure: unknown): Failure =>
  typeof failure === 'object' && failure !== null && '_tag' in failure
    ? { ...(failure as Failure), _tag: String((failure as Failure)._tag) }
    : { _tag: 'Defect', detail: String(failure) };

type Held = {
  readonly handle: number;
  readonly descriptor: Descriptor;
  readonly chunks: Uint8Array[];
  bytes: number;
  ended: boolean;
  failure: ChannelFailed | undefined;
  stopped: boolean;
  pump: Fiber.Fiber<void> | undefined;
  changed: Deferred.Deferred<void>;
};

type HostedInput = { readonly scope: Scope.Closeable; readonly queue: ExecutionInput };

type Reported = { readonly pending: AdmittedInputs; sent: boolean };

const stoppedFailure = () => new ChannelFailed({ reason: 'stopped', detail: 'reading was stopped on this terminal before it took a byte' });
const unknownHandle = (handle: number) =>
  new ChannelFailed({ reason: 'closed', detail: `the terminal thread holds no terminal ${handle}` });

const program = Effect.gen(function* () {
  const requests = yield* Queue.unbounded<Request>();
  self.onmessage = (event: MessageEvent<Request>) => Queue.offerUnsafe(requests, event.data);
  send({ _tag: 'Ready' });

  const opened = yield* Effect.gen(function* () {
    for (;;) {
      const request = yield* Queue.take(requests);
      if (request._tag !== 'Open') continue;
      const loaded = yield* Effect.try({ try: () => Descriptors.load(request.path), catch: (error) => String(error) }).pipe(
        Effect.flatMap((native) => {
          const raised = native.interactive();
          return Effect.map(
            Effect.mapError(Reactor.open(native), (failure) => failure.detail),
            (reactor) => ({ native, reactor, interactive: raised === undefined ? undefined : raised.detail || raised.refusal }),
          );
        }),
        Effect.result,
      );
      if (loaded._tag === 'Failure') {
        send({ _tag: 'Refused', detail: loaded.failure });
        continue;
      }
      send({ _tag: 'Opened', interactive: loaded.success.interactive });
      return loaded.success;
    }
  });
  const { native, reactor } = opened;

  const terminals = new Map<number, Held>();
  const inputs = new Map<number, HostedInput>();
  const asks = new Map<number, Fiber.Fiber<void>>();
  const questions = new Map<number, Deferred.Deferred<void, Failure>>();
  let questioned = 0;
  let roomed = 0;
  const reported = new Map<number, Reported>();
  const report = (handle: number, held: Reported): void => {
    held.sent = true;
    send({ _tag: 'Admitted', handle, inputs: [...held.pending.values()] });
    held.pending.clear();
  };
  const lanes = yield* makeLanes({
    tail: 2 * READ_AHEAD_BYTES,
    host: {
      input: (handle) => inputs.get(handle)?.queue,
      admitted: (handle, input) => {
        const held = reported.get(handle) ?? { pending: new Map(), sent: false };
        reported.set(handle, held);
        admittedInto(held.pending, input);
        if (!held.sent) report(handle, held);
      },
    },
  });

  const notify = (held: Held): void => {
    const standing = held.changed;
    held.changed = Deferred.makeUnsafe<void>();
    Deferred.doneUnsafe(standing, Exit.void);
  };

  const pump = Effect.fnUntraced(function* (held: Held) {
    for (;;) {
      while (held.bytes >= READ_AHEAD_BYTES && !held.stopped) yield* Deferred.await(held.changed);
      if (held.stopped) return;
      const read = yield* Effect.result(held.descriptor.read(TRANSFER_LIMIT));
      if (read._tag === 'Failure') {
        if (read.failure.reason !== 'stopped') {
          held.failure = read.failure;
          lanes.ended(held.handle);
        }
        notify(held);
        return;
      }
      if (read.success === undefined) {
        held.ended = true;
        lanes.ended(held.handle);
        notify(held);
        return;
      }
      held.chunks.push(read.success);
      held.bytes += read.success.length;
      lanes.pumped(held.handle, read.success);
      notify(held);
    }
  });

  const take = (held: Held, limit: number): Uint8Array => {
    const head = held.chunks[0]!;
    if (head.length <= limit) {
      held.chunks.shift();
      held.bytes -= head.length;
      notify(held);
      return head;
    }
    held.chunks[0] = head.subarray(limit);
    held.bytes -= limit;
    notify(held);
    return head.slice(0, limit);
  };

  const heldOf = (handle: number): Effect.Effect<Held, ChannelFailed> =>
    Effect.suspend(() => {
      const held = terminals.get(handle);
      return held === undefined ? Effect.fail(unknownHandle(handle)) : Effect.succeed(held);
    });

  const read = Effect.fnUntraced(function* (held: Held, limit: number) {
    if (held.pump === undefined && !held.stopped) held.pump = yield* Effect.forkDetach(pump(held));
    for (;;) {
      if (held.stopped) return yield* stoppedFailure();
      if (held.bytes > 0) return take(held, Math.max(1, limit));
      if (held.ended) return undefined;
      if (held.failure !== undefined) return yield* held.failure;
      yield* Deferred.await(held.changed);
    }
  });

  const stopReading = Effect.fnUntraced(function* (held: Held) {
    held.stopped = true;
    yield* held.descriptor.stopReading;
    notify(held);
    if (held.pump !== undefined) yield* Fiber.await(held.pump);
  });

  const pendingEchoes = (held: Held): Effect.Effect<ReadonlyArray<PendingEcho>> =>
    Effect.map(held.descriptor.pendingEchoes, (echoes) => {
      if (held.bytes === 0) return echoes;
      const buffered = new Uint8Array(held.bytes);
      let at = 0;
      for (const chunk of held.chunks) {
        buffered.set(chunk, at);
        at += chunk.length;
      }
      return [{ after: 0, bytes: buffered, output: true }, ...echoes];
    });

  const question = (handle: number, asked: Question): Effect.Effect<void, Failure> =>
    Effect.suspend(() => {
      const id = (questioned += 1);
      const settled = Deferred.makeUnsafe<void, Failure>();
      questions.set(id, settled);
      send({ _tag: 'Question', id, handle, question: asked });
      return Effect.ensuring(
        Deferred.await(settled),
        Effect.sync(() => questions.delete(id)),
      );
    });

  const openInput = Effect.fnUntraced(function* (handle: number, held: Held, ask: Extract<Ask, { readonly _tag: 'OpenInput' }>) {
    if (inputs.has(handle)) return yield* new ChannelFailed({ reason: 'os', detail: `terminal ${handle} already holds its input` });
    const scope = yield* Scope.make();
    const sink = terminalSink(
      held.descriptor,
      () =>
        question(handle, { _tag: 'CloseInput' }).pipe(
          Effect.mapError(
            (failure) =>
              new InputWriteFailed({ reason: 'closed', detail: typeof failure.detail === 'string' ? failure.detail : failure._tag }),
          ),
        ),
      (geometry) =>
        question(handle, { _tag: 'Resized', geometry }).pipe(
          Effect.mapError(
            (failure) =>
              new InputActUnsupported({
                act: 'resize',
                reason: failure.reason === 'geometry' ? 'geometry' : 'unreadable',
                detail: typeof failure.detail === 'string' ? failure.detail : failure._tag,
              }),
          ),
        ),
    );
    const queue = yield* makeExecutionInput({
      sink,
      limits: ask.limits,
      ref: ask.ref,
      announce: Effect.sync(() => send({ _tag: 'Announce', handle })),
      carried: ask.carried,
    }).pipe(Scope.provide(scope));
    inputs.set(handle, { scope, queue });
    if (held.pump === undefined) lanes.feed(handle, ask.ref, ask.output);
  });

  const inputOf = (handle: number): Effect.Effect<ExecutionInput, ChannelFailed> =>
    Effect.suspend(() => {
      const hosted = inputs.get(handle);
      return hosted === undefined
        ? Effect.fail(new ChannelFailed({ reason: 'closed', detail: `terminal ${handle} holds no input` }))
        : Effect.succeed(hosted.queue);
    });

  const replied = Effect.fnUntraced(function* (handle: number, answer: Effect.Success<ReturnType<ExecutionInput['reply']>>) {
    if (answer._tag !== 'ReplyBackpressure') return answer satisfies ReplyAnswered;
    if (answer.room === undefined) return { ...answer, room: undefined } satisfies ReplyAnswered;
    const room = (roomed += 1);
    yield* Effect.forkDetach(
      Effect.andThen(
        answer.room,
        Effect.sync(() => send({ _tag: 'Room', handle, room })),
      ),
    );
    return { ...answer, room } satisfies ReplyAnswered;
  });

  const inputAnswer = Effect.fnUntraced(function* (handle: number, ask: InputAsk) {
    if (ask._tag === 'Dispose') {
      lanes.forget(handle);
      reported.delete(handle);
      const hosted = inputs.get(handle);
      inputs.delete(handle);
      if (hosted !== undefined) yield* Scope.close(hosted.scope, Exit.void);
      return undefined;
    }
    if (ask._tag === 'EndLane') return lanes.end(handle, ask.binding);
    if (ask._tag === 'OpenLane') return yield* lanes.open(handle, ask.binding);
    const queue = yield* inputOf(handle);
    switch (ask._tag) {
      case 'Next':
        return yield* queue.next(ask.binding);
      case 'Admit':
        return (yield* queue.admit(ask.request, ask.binding)) satisfies InputAnswer;
      case 'CloseIntake':
        return yield* queue.closeIntake();
      case 'Halt':
        return yield* queue.halt(Duration.millis(ask.withinMs));
      case 'Reply':
        return yield* replied(handle, yield* queue.reply(ask.bytes, ask.settling));
      case 'EndLanes':
        lanes.end(handle);
        return yield* queue.endLanes();
      case 'CloseLane':
        lanes.end(handle, ask.binding, ask.principal);
        return yield* queue.closeLane(ask.binding, ask.principal);
      case 'Finish':
        return yield* queue.finish();
      case 'Fence':
        return (yield* queue.fence(ask.reason, ask.detail)) satisfies InputOwed;
      case 'Frontier':
        return yield* queue.frontier;
      case 'PendingBytes':
        return yield* queue.pendingBytes;
      case 'PendingActs':
        return yield* queue.pendingActs;
    }
  });

  const answer = Effect.fnUntraced(function* (ask: Ask) {
    if (ask._tag === 'Input') return yield* inputAnswer(ask.handle, ask.ask);
    const held = yield* heldOf(ask.handle);
    switch (ask._tag) {
      case 'Read':
        return yield* read(held, ask.limit);
      case 'StopReading':
        return yield* stopReading(held);
      case 'Write':
        return yield* held.descriptor.write(ask.bytes);
      case 'StopWriting':
        return yield* held.descriptor.stopWriting;
      case 'Resize':
        return yield* held.descriptor.resize(ask.rows, ask.cols);
      case 'Size':
        return yield* held.descriptor.size;
      case 'Foreground':
        return yield* held.descriptor.foreground;
      case 'Facts':
        return yield* held.descriptor.facts(ask.pid);
      case 'Interrupt': {
        let flushed = false;
        const count = yield* held.descriptor.interrupt(() => {
          flushed = true;
        });
        return { count, flushed };
      }
      case 'PendingEchoes':
        return yield* pendingEchoes(held);
      case 'Owe':
        if (held.pump !== undefined) {
          return yield* new ChannelFailed({ reason: 'os', detail: 'owed bytes arrived after this terminal started reading' });
        }
        return yield* held.descriptor.owe(ask.echoes);
      case 'OpenInput':
        return yield* openInput(ask.handle, held, ask);
    }
  });

  const close = Effect.fnUntraced(function* (handle: number) {
    const held = terminals.get(handle);
    if (held === undefined) return;
    terminals.delete(handle);
    lanes.forget(handle);
    if (held.pump !== undefined) yield* Fiber.interrupt(held.pump);
    held.descriptor.close();
    held.failure ??= new ChannelFailed({ reason: 'closed', detail: 'the descriptor was closed by this process' });
    notify(held);
  });

  for (;;) {
    const request = yield* Queue.take(requests);
    switch (request._tag) {
      case 'Open':
        send({ _tag: 'Opened', interactive: undefined });
        break;
      case 'Shutdown':
        yield* Effect.forEach([...asks.values()], Fiber.interrupt, { discard: true });
        for (const handle of [...inputs.keys()]) yield* inputAnswer(handle, { _tag: 'Dispose' });
        for (const handle of [...terminals.keys()]) yield* close(handle);
        if (yield* reactor.retire) native.unload();
        send({ _tag: 'Closed' });
        return;
      case 'Adopt':
        terminals.set(request.handle, {
          handle: request.handle,
          descriptor: new Descriptor(native, reactor, request.fd),
          chunks: [],
          bytes: 0,
          ended: false,
          failure: undefined,
          stopped: false,
          pump: undefined,
          changed: Deferred.makeUnsafe<void>(),
        });
        break;
      case 'Close':
        yield* close(request.handle);
        break;
      case 'Ask': {
        const id = request.id;
        const fiber = yield* Effect.forkDetach(
          answer(request.ask).pipe(
            Effect.matchCause({
              onSuccess: (value) => send({ _tag: 'Answered', id, value }),
              onFailure: (cause) => {
                const failure = cause.reasons.find((reason) => reason._tag === 'Fail');
                if (failure !== undefined) return send({ _tag: 'Failed', id, failure: projected(failure.error) });
                if (cause.reasons.every((reason) => reason._tag === 'Interrupt'))
                  return send({ _tag: 'Failed', id, failure: { _tag: 'Cancelled' } });
                send({ _tag: 'Failed', id, failure: { _tag: 'Defect', detail: String(cause) } });
              },
            }),
            Effect.ensuring(Effect.sync(() => asks.delete(id))),
          ),
        );
        asks.set(id, fiber);
        break;
      }
      case 'Cancel': {
        const fiber = asks.get(request.id);
        if (fiber !== undefined) yield* Effect.forkDetach(Fiber.interrupt(fiber));
        break;
      }
      case 'Settled': {
        const settled = questions.get(request.id);
        if (settled !== undefined) Deferred.doneUnsafe(settled, request.failure === undefined ? Exit.void : Exit.fail(request.failure));
        break;
      }
      case 'Taken': {
        const held = reported.get(request.handle);
        if (held === undefined) break;
        held.sent = false;
        if (held.pending.size > 0) report(request.handle, held);
        break;
      }
    }
  }
});

Effect.runFork(program);
