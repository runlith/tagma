import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Deferred, Duration, Effect, Fiber } from 'effect';
import { InstallationId, ExecutionId, type ExecutionRef } from '@runlith/executions/protocol/execution';
import type { InputAnswer, InputRequest } from '@runlith/executions/protocol/input';
import { type ExecutionInput, InputActUnsupported, InputWriteFailed, type InputSink, makeExecutionInput } from './ExecutionInput';
import { admit, laneBinding, runtimeProfile } from './runtimeFixture';
import { refusalOf } from './refusals';

const ref: ExecutionRef = {
  installation: InstallationId.make('installation-1'),
  execution: ExecutionId.make('execution-1'),
  incarnation: 0,
};
const limits = runtimeProfile({ inputPendingBytes: 64, inputReceipts: 2 }).execution;
const lanesLimits = runtimeProfile({ inputPendingBytes: 4096, inputReceipts: 128 }).execution;
const bytes = (text: string) => new TextEncoder().encode(text);
const text = (value: Uint8Array) => new TextDecoder().decode(value);
const write = (sequence: number, value: string): InputRequest => ({
  sequence,
  cause: 'typed',
  act: { _tag: 'Write', bytes: bytes(value) },
});
const act = (sequence: number) => write(sequence, String(sequence).padStart(16, '0'));
const end = (sequence: number): InputRequest => ({ sequence, cause: 'end', act: { _tag: 'End' } });

type ParkedSink = {
  readonly sink: InputSink;
  readonly taking: Deferred.Deferred<void>;
  readonly release: Deferred.Deferred<void>;
  readonly taken: Uint8Array[];
  readonly performed: string[];
};
const parkedSink = (): ParkedSink => {
  const taking = Deferred.makeUnsafe<void>();
  const release = Deferred.makeUnsafe<void>();
  const taken: Uint8Array[] = [];
  const performed: string[] = [];
  const sink: InputSink = {
    initiallyClosed: false,
    write: Effect.fnUntraced(function* (entry) {
      taken.push(entry);
      yield* Deferred.succeed(taking, undefined);
      yield* Deferred.await(release);
      performed.push(text(entry));
      return entry.length;
    }),
    stop: Effect.void,
    interrupt: () =>
      Effect.fail(new InputActUnsupported({ act: 'interrupt', reason: 'transport', detail: 'this sink has no line discipline' })),
    resize: () => Effect.fail(new InputActUnsupported({ act: 'resize', reason: 'transport', detail: 'this sink has no geometry' })),
    end: {
      _tag: 'Closes',
      close: () =>
        Effect.sync(() => {
          performed.push('end');
        }),
    },
  };
  return { sink, taking, release, taken, performed };
};
const unendableSink = (): InputSink => ({
  initiallyClosed: false,
  write: (entry) => Effect.succeed(entry.length),
  stop: Effect.void,
  interrupt: () =>
    Effect.fail(new InputActUnsupported({ act: 'interrupt', reason: 'transport', detail: 'this sink has no line discipline' })),
  resize: () => Effect.fail(new InputActUnsupported({ act: 'resize', reason: 'transport', detail: 'this sink has no geometry' })),
  end: {
    _tag: 'Unsupported',
    refusal: new InputActUnsupported({ act: 'end', reason: 'transport', detail: 'this sink holds no input descriptor to close' }),
  },
});
const withInput = <A, E, R>(sink: InputSink, body: (input: ExecutionInput) => Effect.Effect<A, E, R>, bounds = limits) =>
  Effect.flatMap(makeExecutionInput({ sink, limits: bounds, ref, announce: Effect.void }), body);
const untilDrained = Effect.fnUntraced(function* (input: ExecutionInput) {
  while ((yield* input.pendingActs) !== 0) yield* Effect.yieldNow;
  return yield* input.pendingBytes;
});

describe('the input queue answers for what it owes', () => {
  it.live('delivers interrupt and resize while byte input is blocked, and retries only the receipt', () =>
    Effect.gen(function* () {
      const child = parkedSink();
      yield* withInput(
        {
          ...child.sink,
          interrupt: () =>
            Effect.sync(() => {
              child.performed.push('interrupt');
              return 1;
            }),
          resize: () =>
            Effect.sync(() => {
              child.performed.push('resize');
            }),
        },
        Effect.fnUntraced(function* (input) {
          yield* admit(input, write(0, 'before'));
          yield* Deferred.await(child.taking);
          const request: InputRequest = { sequence: 1, cause: 'interrupt', act: { _tag: 'Interrupt' } };
          const first = yield* admit(input, request).pipe(Effect.timeout(500));
          expect(first._tag).toBe('InputAdmitted');
          expect(yield* admit(input, request)).toEqual(first);
          expect(
            (yield* admit(input, { sequence: 2, cause: 'resize', act: { _tag: 'Resize', geometry: { rows: 12, columns: 40 } } }))._tag,
          ).toBe('InputAdmitted');
          expect(child.performed).toEqual(['interrupt', 'resize']);
          yield* admit(input, write(3, 'after'));
          yield* Deferred.succeed(child.release, undefined);
          yield* untilDrained(input);
          expect(child.performed).toEqual(['interrupt', 'resize', 'before', 'after']);
        }),
      );
    }),
  );

  it.live('abandons queued and in-flight paste when the transport flushes input, then accepts new input', () =>
    Effect.gen(function* () {
      const child = parkedSink();
      let replying: Effect.Effect<void> = Effect.void;
      yield* withInput(
        {
          ...child.sink,
          interrupt: Effect.fnUntraced(function* (onFlush) {
            onFlush?.();
            yield* replying;
            return 1;
          }),
        },
        Effect.fnUntraced(function* (input) {
          replying = Effect.asVoid(input.reply(bytes('response'), false).pipe(Effect.orDie));
          yield* admit(input, write(0, 'before'));
          yield* Deferred.await(child.taking);
          yield* admit(input, write(1, 'queued'));
          const request: InputRequest = { sequence: 2, cause: 'interrupt', act: { _tag: 'Interrupt' } };
          const receipt = yield* admit(input, request);
          expect(receipt._tag).toBe('InputAdmitted');
          expect(yield* admit(input, request)).toEqual(receipt);
          yield* Deferred.succeed(child.release, undefined);
          yield* admit(input, write(3, 'after'));
          yield* untilDrained(input);
          expect(child.performed).toEqual(['response', 'after']);
          expect(yield* input.fence('stopping', 'test completed')).toEqual({ queued: 6, inFlight: 6, ended: false });
        }),
      );
    }),
  );

  it.live('refuses a fenced interrupt without delivering it while an earlier byte write settles', () =>
    Effect.gen(function* () {
      const child = parkedSink();
      yield* withInput(
        {
          ...child.sink,
          interrupt: () =>
            Effect.sync(() => {
              child.performed.push('interrupt');
              return 1;
            }),
        },
        Effect.fnUntraced(function* (input) {
          yield* admit(input, write(0, 'before'));
          yield* Deferred.await(child.taking);
          yield* input.fence('stopping', 'the stop owns the queue');
          expect(yield* Effect.flip(admit(input, { sequence: 1, cause: 'interrupt', act: { _tag: 'Interrupt' } }))).toMatchObject({
            _tag: 'InputFenced',
          });
          yield* Deferred.succeed(child.release, undefined);
          yield* untilDrained(input);
          expect(child.performed).toEqual(['before']);
        }),
      );
    }),
  );

  it.live('spends no input sequence on an interrupt the terminal refuses', () =>
    withInput(
      unendableSink(),
      Effect.fnUntraced(function* (input) {
        expect(yield* admit(input, { sequence: 0, cause: 'interrupt', act: { _tag: 'Interrupt' } })).toMatchObject({
          _tag: 'InputUnsupported',
          act: 'interrupt',
          reason: 'transport',
        });
        expect(yield* admit(input, write(0, 'accepted'))).toMatchObject({ _tag: 'InputAdmitted' });
      }),
    ),
  );

  it.live('separates bytes nobody wrote from bytes a write was holding, and keeps both charged until they settle', () =>
    Effect.gen(function* () {
      const child = parkedSink();
      yield* withInput(
        child.sink,
        Effect.fnUntraced(function* (input) {
          expect((yield* admit(input, write(0, 'first')))._tag).toBe('InputAdmitted');
          yield* Deferred.await(child.taking);
          expect((yield* admit(input, write(1, 'second!')))._tag).toBe('InputAdmitted');
          expect(yield* input.pendingBytes).toBe(12);
          expect(yield* input.fence('stopping', 'explicit stop')).toEqual({ queued: 7, inFlight: 5, ended: false });
          expect(yield* input.pendingBytes).toBe(5);
          yield* Deferred.succeed(child.release, undefined);
          expect(yield* untilDrained(input)).toBe(0);
          expect(child.taken).toHaveLength(1);
        }),
      );
    }),
  );

  it.live('charges the queue for bytes a write is still holding, so admission cannot spend the room twice', () =>
    Effect.gen(function* () {
      const child = parkedSink();
      yield* withInput(
        child.sink,
        Effect.fnUntraced(function* (input) {
          expect((yield* admit(input, write(0, 'x'.repeat(32))))._tag).toBe('InputAdmitted');
          yield* Deferred.await(child.taking);
          expect((yield* admit(input, write(1, 'y'.repeat(32))))._tag).toBe('InputAdmitted');
          expect(yield* admit(input, write(2, 'z'.repeat(32)))).toMatchObject({ _tag: 'InputBackpressure', pendingBytes: 64, limit: 64 });
          yield* Deferred.succeed(child.release, undefined);
        }),
      );
    }),
  );

  it.live('still owes what a broken write left, so the stop that follows reports it rather than nothing', () =>
    Effect.gen(function* () {
      const child = parkedSink();
      const failed = yield* Deferred.make<void>();
      yield* withInput(
        {
          ...child.sink,
          write: Effect.fnUntraced(function* () {
            yield* Deferred.succeed(child.taking, undefined);
            yield* Deferred.await(child.release);
            yield* Deferred.succeed(failed, undefined);
            return yield* new InputWriteFailed({ reason: 'closed', detail: 'the child stdin closed under the write' });
          }),
        },
        Effect.fnUntraced(function* (input) {
          yield* admit(input, write(0, 'inflight'));
          yield* Deferred.await(child.taking);
          yield* admit(input, write(1, 'queued'));
          yield* Deferred.succeed(child.release, undefined);
          yield* Deferred.await(failed);
          while ((yield* input.frontier).pendingBytes !== 0) yield* Effect.yieldNow;
          expect(yield* input.fence('stopping', 'explicit stop')).toEqual({ queued: 6, inFlight: 8, ended: false });
        }),
      );
    }),
  );

  it.live('closes the child input after the acts admitted before it, and admits nothing that would reach it afterwards', () =>
    Effect.gen(function* () {
      const child = parkedSink();
      yield* withInput(
        child.sink,
        Effect.fnUntraced(function* (input) {
          expect((yield* admit(input, write(0, 'first')))._tag).toBe('InputAdmitted');
          yield* Deferred.await(child.taking);
          const ended = yield* admit(input, end(1));
          expect(ended).toMatchObject({ _tag: 'InputAdmitted', receipt: { bytes: 0, acceptedThrough: '5', cause: 'end' } });
          expect(child.performed).toEqual([]);
          yield* Deferred.succeed(child.release, undefined);
          yield* untilDrained(input);
          expect(child.performed).toEqual(['first', 'end']);
          expect(yield* admit(input, write(2, 'late'))).toEqual({ _tag: 'InputEnded' });
          expect(yield* admit(input, end(1))).toEqual(ended);
        }),
      );
    }),
  );

  it.live('still owes an admitted end nobody performed, and refuses the bytes a lane opened after it types', () =>
    Effect.gen(function* () {
      const child = parkedSink();
      yield* withInput(
        child.sink,
        Effect.fnUntraced(function* (input) {
          yield* admit(input, write(0, 'first'));
          yield* Deferred.await(child.taking);
          yield* admit(input, end(1));
          yield* input.endLanes();
          expect(yield* admit(input, write(0, 'late'), laneBinding('operator', 'later'))).toEqual({ _tag: 'InputEnded' });
          expect(yield* input.fence('stopping', 'explicit stop')).toEqual({ queued: 0, inFlight: 5, ended: true });
          expect(child.performed).toEqual([]);
          yield* Deferred.succeed(child.release, undefined);
        }),
      );
    }),
  );

  it.live('refuses an end the transport cannot perform, and spends no sequence on it', () =>
    withInput(
      unendableSink(),
      Effect.fnUntraced(function* (input) {
        expect(yield* admit(input, end(0))).toMatchObject({ _tag: 'InputUnsupported', act: 'end', reason: 'transport' });
        expect((yield* admit(input, write(0, 'typed')))._tag).toBe('InputAdmitted');
      }),
    ),
  );

  it.live('answers a retry from its own retained window, and says so when the sequence has rolled out of it', () =>
    Effect.gen(function* () {
      const child = parkedSink();
      yield* Deferred.succeed(child.release, undefined);
      yield* withInput(
        child.sink,
        Effect.fnUntraced(function* (input) {
          const admitted: InputAnswer[] = [];
          for (let sequence = 0; sequence < 3; sequence++) admitted.push(yield* admit(input, write(sequence, `act-${sequence}`)));
          expect(admitted.map((answer) => answer._tag)).toEqual(['InputAdmitted', 'InputAdmitted', 'InputAdmitted']);
          expect(admitted[2]).toEqual(yield* admit(input, write(2, 'act-2')));
          expect((yield* admit(input, write(2, 'act-two')))._tag).toBe('InputConflict');
          expect(yield* admit(input, write(0, 'act-0'))).toMatchObject({ _tag: 'InputReceiptExpired', retainedFrom: 1 });
        }),
      );
    }),
  );

  it.live('answers a sequence ahead of one refused for pressure with that same backpressure, and admits the re-sends in order', () =>
    Effect.gen(function* () {
      const child = parkedSink();
      yield* withInput(
        child.sink,
        Effect.fnUntraced(function* (input) {
          for (let sequence = 0; sequence < 4; sequence++) yield* admit(input, act(sequence));
          yield* Deferred.await(child.taking);
          const refused: InputAnswer[] = [];
          for (let sequence = 4; sequence < 8; sequence++) refused.push(yield* admit(input, act(sequence)));
          expect(refused.map((answer) => answer._tag)).toEqual(Array(4).fill('InputBackpressure'));
          expect(refused[1]).toMatchObject({ frontier: { sequence: 3 } });
          yield* Deferred.succeed(child.release, undefined);
          yield* untilDrained(input);
          const resent: InputAnswer[] = [];
          for (let sequence = 4; sequence < 8; sequence++) resent.push(yield* admit(input, act(sequence)));
          yield* untilDrained(input);
          expect(resent.map((answer) => (answer._tag === 'InputAdmitted' ? answer.receipt.sequence : -1))).toEqual([4, 5, 6, 7]);
          expect((yield* admit(input, act(9)))._tag).toBe('InputConflict');
          expect(child.performed).toEqual([0, 1, 2, 3, 4, 5, 6, 7].map((sequence) => String(sequence).padStart(16, '0')));
        }),
      );
    }),
  );

  it.live('still reads a sequence ahead of the frontier as a conflict when nothing was refused for pressure', () =>
    withInput(
      unendableSink(),
      Effect.fnUntraced(function* (input) {
        expect((yield* admit(input, act(0)))._tag).toBe('InputAdmitted');
        expect(yield* admit(input, act(2))).toEqual({ _tag: 'InputConflict', sequence: 2 });
      }),
    ),
  );

  it.live('counts each binding in its own lane, so neither writer reads the other as a conflict', () =>
    withInput(
      unendableSink(),
      Effect.fnUntraced(function* (input) {
        const page = laneBinding('operator', 'page');
        const server = laneBinding('operator', 'server');
        const answers = [
          yield* admit(input, write(0, 'page'), page),
          yield* admit(input, write(0, 'server'), server),
          yield* admit(input, write(1, 'page-again'), page),
          yield* admit(input, write(1, 'server-again'), server),
        ];
        expect(answers.map((answer) => answer._tag)).toEqual(Array(4).fill('InputAdmitted'));
      }),
    ),
  );

  it.live('drops a closed lane and its receipts only for the principal that opened it', () =>
    withInput(
      unendableSink(),
      Effect.fnUntraced(function* (input) {
        const page = laneBinding('operator', 'page');
        const first = yield* admit(input, write(0, 'page'), page);
        yield* input.closeLane(page.id, laneBinding('agent').principal);
        expect(yield* admit(input, write(0, 'page'), page)).toEqual(first);
        yield* input.closeLane(page.id, page.principal);
        expect(yield* admit(input, write(0, 'page'), page)).toMatchObject({ _tag: 'InputAdmitted', receipt: { acceptedThrough: '8' } });
      }),
    ),
  );

  it.live('drops every lane and its retained receipts when lanes end, while the accepted byte count stands', () =>
    withInput(
      unendableSink(),
      Effect.fnUntraced(function* (input) {
        const page = laneBinding('operator', 'page');
        const server = laneBinding('operator', 'server');
        yield* admit(input, write(0, 'page'), page);
        yield* admit(input, write(0, 'server'), server);
        yield* admit(input, write(1, 'server-again'), server);
        yield* input.endLanes();
        expect((yield* admit(input, write(1, 'server-again'), server))._tag).toBe('InputConflict');
        expect(yield* admit(input, write(0, 'after'), page)).toMatchObject({ _tag: 'InputAdmitted', receipt: { acceptedThrough: '27' } });
        const frontier = yield* input.frontier;
        expect(frontier.sequence).toBeUndefined();
        expect(String(frontier.acceptedThrough)).toBe('27');
      }),
    ),
  );

  it.live('answers four lanes of thirty-two acts each from their own receipts when every act is sent again', () =>
    withInput(
      unendableSink(),
      Effect.fnUntraced(function* (input) {
        const lanes = ['page', 'window', 'harness', 'agent'].map((name) => laneBinding(name));
        const first: InputAnswer[] = [];
        for (let sequence = 0; sequence < 32; sequence++) {
          for (const lane of lanes) first.push(yield* admit(input, write(sequence, `${lane.principal}-${sequence}`), lane));
        }
        yield* untilDrained(input);
        const again: InputAnswer[] = [];
        for (const lane of lanes)
          for (let sequence = 0; sequence < 32; sequence++)
            again.push(yield* admit(input, write(sequence, `${lane.principal}-${sequence}`), lane));
        expect(first.every((answer) => answer._tag === 'InputAdmitted')).toBe(true);
        expect(again).toEqual([0, 1, 2, 3].flatMap((lane) => first.filter((_, index) => index % 4 === lane)));
        expect(String((yield* input.frontier).acceptedThrough)).toBe(
          String(first.reduce((sum, answer) => sum + (answer._tag === 'InputAdmitted' ? answer.receipt.bytes : 0), 0)),
        );
      }),
      lanesLimits,
    ),
  );

  it.live('evicts the oldest receipts of the least recently admitted or retried lane when the execution window is full', () =>
    withInput(
      unendableSink(),
      Effect.fnUntraced(function* (input) {
        const resending = laneBinding('resending');
        const busy = laneBinding('busy');
        const idle = laneBinding('idle');
        const fourth = laneBinding('fourth');
        const fill = (lane: ReturnType<typeof laneBinding>, from: number, to: number) =>
          Effect.forEach(
            Array.from({ length: to - from }, (_, index) => from + index),
            (sequence) => admit(input, write(sequence, `${lane.principal}-${sequence}`), lane),
          );
        yield* fill(busy, 0, 33);
        expect(yield* admit(input, write(0, 'busy-0'), busy)).toEqual({ _tag: 'InputReceiptExpired', sequence: 0, retainedFrom: 1 });
        expect((yield* admit(input, write(1, 'busy-1'), busy))._tag).toBe('InputAdmitted');
        yield* fill(resending, 0, 32);
        yield* fill(idle, 0, 32);
        yield* fill(fourth, 0, 32);
        yield* admit(input, write(33, 'busy-33'), busy);
        yield* untilDrained(input);
        expect((yield* admit(input, write(5, 'resending-5'), resending))._tag).toBe('InputAdmitted');
        yield* fill(laneBinding('late'), 0, 2);
        expect(yield* admit(input, write(0, 'idle-0'), idle)).toEqual({ _tag: 'InputReceiptExpired', sequence: 0, retainedFrom: 2 });
        expect((yield* admit(input, write(1, 'idle-1'), idle))._tag).toBe('InputReceiptExpired');
        expect((yield* admit(input, write(2, 'idle-2'), idle))._tag).toBe('InputAdmitted');
        expect((yield* admit(input, write(0, 'resending-0'), resending))._tag).toBe('InputAdmitted');
        expect((yield* admit(input, write(0, 'fourth-0'), fourth))._tag).toBe('InputAdmitted');
        expect((yield* admit(input, write(2, 'busy-2'), busy))._tag).toBe('InputAdmitted');
      }),
      lanesLimits,
    ),
  );
});

describe('a halted input carries what it owes to the next logic', () => {
  it.effect('a yielding logic refuses input as temporary instead of reporting its end', () =>
    withInput(
      unendableSink(),
      Effect.fnUntraced(function* (input) {
        yield* input.closeIntake();
        const refused = yield* Effect.flip(admit(input, write(0, 'waiting')));
        expect(refusalOf(refused)._tag).toBe('InputYielding');
        expect((yield* input.frontier).pendingBytes).toBe(0);
      }),
    ),
  );
  it.live('keeps the queue in the carry when a fence lands while the writer stops', () =>
    Effect.gen(function* () {
      const child = parkedSink();
      yield* withInput(
        child.sink,
        Effect.fnUntraced(function* (input) {
          yield* admit(input, write(0, 'first'));
          yield* Deferred.await(child.taking);
          yield* admit(input, write(1, 'second'));
          const halting = yield* Effect.forkChild(input.halt(Duration.seconds(1)));
          yield* Effect.yieldNow;
          yield* input.fence('stopping', 'a stop arrived while the logic yielded');
          yield* Deferred.succeed(child.release, undefined);
          const carry = yield* Fiber.join(halting);
          expect(child.performed).toEqual(['first']);
          expect(text(carry.remainder)).toBe('second');
          expect(String(carry.accepted)).toBe('11');
        }),
      );
    }),
  );

  it.live('answers within its budget with the queue as it stands when the writer never returns', () =>
    Effect.gen(function* () {
      const child = parkedSink();
      yield* withInput(
        child.sink,
        Effect.fnUntraced(function* (input) {
          yield* admit(input, write(0, 'stuck'));
          yield* Deferred.await(child.taking);
          yield* admit(input, write(1, 'queued'));
          yield* admit(input, end(2));
          const carry = yield* input.halt(Duration.millis(20));
          expect(text(carry.remainder)).toBe('queued');
          expect(carry.ended).toBe(true);
          expect(String(carry.accepted)).toBe('11');
        }),
      );
    }),
  );

  it.live('holds a reply refused for want of room until the queue drains, and lets a settling reply past the budget', () =>
    Effect.gen(function* () {
      const child = parkedSink();
      yield* withInput(
        child.sink,
        Effect.fnUntraced(function* (input) {
          yield* admit(input, write(0, 'x'.repeat(60)));
          yield* Deferred.await(child.taking);
          const refused = yield* input.reply(bytes('\x1b[1;1R'), false);
          expect(refused._tag).toBe('ReplyBackpressure');
          const settled = yield* input.reply(bytes('\x1b[2;2R'), true);
          expect(settled._tag).toBe('ReplyQueued');
          if (refused._tag !== 'ReplyBackpressure' || refused.room === undefined)
            return yield* Effect.die(new Error('no room wake for refused reply'));
          yield* Deferred.succeed(child.release, undefined);
          yield* refused.room;
        }),
      );
    }),
  );
});
