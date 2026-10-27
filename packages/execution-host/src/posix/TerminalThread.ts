import { Data, Deferred, Duration, Effect, Exit } from 'effect';
import { TRANSFER_LIMIT } from '@runlith/executions/protocol/capacity';
import type { ProcessWitness } from '@runlith/executions/protocol/evidence';
import type { InputAnswer, InputFrontier, InputSequence } from '@runlith/executions/protocol/input';
import type { TerminalLane } from '@runlith/executions/protocol/lane';
import { offsetValue } from '@runlith/executions/protocol/record';
import { InputFenced, type ExecutionInput, type InputCarry, type InputOwed, type ReplyAnswer } from '../ExecutionInput';
import { ChannelFailed, ForegroundRefused, TerminalInterruptRefused, type PendingEcho, type Terminal } from '../holder/Holder';
import type { HeldTerminal } from '../holder-client/Link';
import { LaneUnserved, type TerminalEndpoint, type TerminalInput, type TerminalInputOptions, type TerminalInputs } from '../TerminalInputs';
import type { TerminalFacts } from './native';
import type { Answer, Ask, Failure, InputAsk, ReplyAnswered, Request } from './terminals.worker';

const OPEN_MS = 10_000;

export class TerminalThreadUnavailable extends Data.TaggedError('TerminalThreadUnavailable')<{ readonly detail: string }> {
  override get message(): string {
    return this.detail;
  }
}

export type ThreadTerminal = HeldTerminal & {
  readonly fd: number;
  readonly facts: (pid: number) => Effect.Effect<TerminalFacts, ChannelFailed>;
};

export type TerminalThread = {
  readonly adopt: (fd: number) => ThreadTerminal;
  readonly inputs: TerminalInputs;
};

const adoptedTerminals = new WeakSet<object>();

export const isThreadTerminal = (terminal: Terminal): terminal is ThreadTerminal => adoptedTerminals.has(terminal);

type Settled = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly failure: Failure };

type Hosted = { readonly options: TerminalInputOptions; readonly rooms: Map<number, Deferred.Deferred<void>> };

const detailOf = (failure: Failure): string => (typeof failure.detail === 'string' ? failure.detail : failure._tag);

const channelFailure = (failure: Failure): ChannelFailed =>
  new ChannelFailed({
    reason:
      failure._tag === 'ChannelFailed' && (failure.reason === 'closed' || failure.reason === 'gone' || failure.reason === 'stopped')
        ? failure.reason
        : 'os',
    detail: detailOf(failure),
  });

const threadDefect = (failure: Failure): Effect.Effect<never> =>
  Effect.die(new TerminalThreadUnavailable({ detail: `the terminal thread answered ${failure._tag}: ${detailOf(failure)}` }));

export const openTerminalThread = Effect.fn('posix.TerminalThread.open')(function* (library: string) {
  const services = yield* Effect.context<never>();
  const run = Effect.runForkWith(services);
  const opened = yield* Deferred.make<void, TerminalThreadUnavailable>();
  const waiting = new Map<number, (settled: Settled) => void>();
  const returned = new Map<number, Uint8Array[]>();
  const hosted = new Map<number, Hosted>();
  const handles = new WeakMap<object, number>();
  let asked = 0;
  let adopted = 0;
  let lost: TerminalThreadUnavailable | undefined;

  const end = (worker: Worker, reason: TerminalThreadUnavailable, closing = false): void => {
    if (lost !== undefined) return;
    lost = reason;
    worker.terminate();
    Deferred.doneUnsafe(opened, Exit.fail(reason));
    const settles = [...waiting.values()];
    waiting.clear();
    for (const settle of settles) settle({ ok: false, failure: { _tag: 'ChannelFailed', reason: 'os', detail: reason.detail } });
    if (!closing) run(Effect.logError('the terminal thread ended; terminal reads, writes and input of this logic fail from here', reason));
  };

  const roomOf = (held: Hosted, room: number): Deferred.Deferred<void> => {
    const standing = held.rooms.get(room);
    if (standing !== undefined) return standing;
    const made = Deferred.makeUnsafe<void>();
    held.rooms.set(room, made);
    return made;
  };

  const answered = (worker: Worker, answer: Answer): void => {
    switch (answer._tag) {
      case 'Ready':
        return worker.postMessage({ _tag: 'Open', path: library } satisfies Request);
      case 'Opened':
        if (answer.interactive !== undefined) {
          run(Effect.logWarning('the terminal thread keeps the default scheduling class', { detail: answer.interactive }));
        }
        return void Deferred.doneUnsafe(opened, Exit.void);
      case 'Refused':
        return end(worker, new TerminalThreadUnavailable({ detail: answer.detail }));
      case 'Answered':
      case 'Failed': {
        const settle = waiting.get(answer.id);
        waiting.delete(answer.id);
        return settle?.(answer._tag === 'Answered' ? { ok: true, value: answer.value } : { ok: false, failure: answer.failure });
      }
      case 'Question': {
        const held = hosted.get(answer.handle);
        const asked =
          held === undefined
            ? Effect.fail({ _tag: 'InputMissing', detail: `terminal ${answer.handle} hosts no input on this side` } satisfies Failure)
            : answer.question._tag === 'CloseInput'
              ? held.options.end()
              : held.options.resized(answer.question.geometry);
        run(
          Effect.matchCause(asked, {
            onSuccess: () => worker.postMessage({ _tag: 'Settled', id: answer.id, failure: undefined } satisfies Request),
            onFailure: (cause) => {
              const failed = cause.reasons.find((reason) => reason._tag === 'Fail');
              worker.postMessage({
                _tag: 'Settled',
                id: answer.id,
                failure:
                  failed === undefined
                    ? { _tag: 'Defect', detail: String(cause) }
                    : { ...(failed.error as Failure), _tag: String((failed.error as Failure)._tag) },
              } satisfies Request);
            },
          }),
        );
        return;
      }
      case 'Announce': {
        const held = hosted.get(answer.handle);
        if (held !== undefined) run(held.options.announce);
        return;
      }
      case 'Admitted': {
        worker.postMessage({ _tag: 'Taken', handle: answer.handle } satisfies Request);
        const held = hosted.get(answer.handle);
        if (held !== undefined) run(Effect.forEach(answer.inputs, (input) => held.options.admitted(input), { discard: true }));
        return;
      }
      case 'Room': {
        const held = hosted.get(answer.handle);
        if (held !== undefined) Deferred.doneUnsafe(roomOf(held, answer.room), Exit.void);
        return;
      }
    }
  };

  const worker = yield* Effect.acquireRelease(
    Effect.sync(() => {
      const worker = new Worker(new URL('./terminals.worker.ts', import.meta.url), { type: 'module' });
      worker.onerror = (event) => end(worker, new TerminalThreadUnavailable({ detail: `the terminal thread failed: ${event.message}` }));
      worker.addEventListener('close', () => end(worker, new TerminalThreadUnavailable({ detail: 'the terminal thread ended' })));
      worker.onmessage = (event: MessageEvent<Answer>) => answered(worker, event.data);
      return worker;
    }),
    (worker) => Effect.sync(() => end(worker, new TerminalThreadUnavailable({ detail: 'the terminal thread was closed' }), true)),
  );
  yield* Deferred.await(opened).pipe(
    Effect.timeoutOrElse({
      duration: OPEN_MS,
      orElse: () => new TerminalThreadUnavailable({ detail: `the terminal thread did not open within ${OPEN_MS} ms` }),
    }),
    Effect.tapError((reason) => Effect.sync(() => end(worker, reason))),
  );

  const post = (request: Request): void => {
    if (lost === undefined) worker.postMessage(request);
  };

  const ask = (body: Ask): Effect.Effect<unknown, Failure> =>
    Effect.callback<unknown, Failure>((resume) => {
      if (lost !== undefined) return resume(Effect.fail({ _tag: 'ChannelFailed', reason: 'os', detail: lost.detail }));
      const id = (asked += 1);
      waiting.set(id, (settled) => resume(settled.ok ? Effect.succeed(settled.value) : Effect.fail(settled.failure)));
      worker.postMessage({ _tag: 'Ask', id, ask: body } satisfies Request);
      return Effect.sync(() => {
        if (!waiting.has(id)) return;
        if (body._tag === 'Read') {
          waiting.set(id, (settled) => {
            if (settled.ok && settled.value instanceof Uint8Array)
              returned.set(body.handle, [...(returned.get(body.handle) ?? []), settled.value]);
          });
        } else waiting.delete(id);
        post({ _tag: 'Cancel', id });
      });
    });

  const unread = (handle: number, limit: number): Uint8Array | undefined => {
    const kept = returned.get(handle);
    const head = kept?.[0];
    if (kept === undefined || head === undefined) return undefined;
    if (head.length <= limit) {
      kept.shift();
      if (kept.length === 0) returned.delete(handle);
      return head;
    }
    kept[0] = head.subarray(limit);
    return head.slice(0, limit);
  };

  const steady = (effect: Effect.Effect<unknown, Failure>): Effect.Effect<void> =>
    effect.pipe(
      Effect.asVoid,
      Effect.catchIf(
        (failure) => failure._tag === 'ChannelFailed' && failure.reason === 'closed',
        () => Effect.void,
      ),
      Effect.catch(threadDefect),
    );

  const adopt = (fd: number): ThreadTerminal => {
    const handle = (adopted += 1);
    post({ _tag: 'Adopt', handle, fd });
    const terminal: ThreadTerminal = {
      fd,
      facts: (pid) =>
        ask({ _tag: 'Facts', handle, pid }).pipe(
          Effect.map((value) => value as TerminalFacts),
          Effect.mapError(channelFailure),
        ),
      read: (limit = TRANSFER_LIMIT) =>
        Effect.suspend(() => {
          const kept = unread(handle, limit);
          if (kept !== undefined) return Effect.succeed(kept);
          return ask({ _tag: 'Read', handle, limit }).pipe(
            Effect.map((value) => value as Uint8Array | undefined),
            Effect.mapError(channelFailure),
          );
        }),
      stopReading: steady(ask({ _tag: 'StopReading', handle })),
      write: (bytes) =>
        ask({ _tag: 'Write', handle, bytes }).pipe(
          Effect.map((value) => value as number),
          Effect.mapError(channelFailure),
        ),
      stopWriting: steady(ask({ _tag: 'StopWriting', handle })),
      resize: (rows, cols) => Effect.asVoid(ask({ _tag: 'Resize', handle, rows, cols })).pipe(Effect.mapError(channelFailure)),
      size: ask({ _tag: 'Size', handle }).pipe(
        Effect.map((value) => value as { readonly rows: number; readonly cols: number }),
        Effect.mapError(channelFailure),
      ),
      foreground: ask({ _tag: 'Foreground', handle }).pipe(
        Effect.map((value) => value as ProcessWitness),
        Effect.mapError(
          (failure) =>
            new ForegroundRefused({
              reason: failure._tag === 'ForegroundRefused' && failure.reason === 'no-terminal' ? 'no-terminal' : 'unreadable',
              detail: detailOf(failure),
            }),
        ),
      ),
      interrupt: (onFlush) =>
        ask({ _tag: 'Interrupt', handle }).pipe(
          Effect.map((value) => {
            const done = value as { readonly count: number; readonly flushed: boolean };
            if (done.flushed) onFlush?.();
            return done.count;
          }),
          Effect.mapError((failure) =>
            failure._tag === 'TerminalInterruptRefused'
              ? new TerminalInterruptRefused({
                  reason: failure.reason === 'isig-disabled' ? 'isig-disabled' : 'no-character',
                  detail: detailOf(failure),
                })
              : channelFailure(failure),
          ),
        ),
      pendingEchoes: ask({ _tag: 'PendingEchoes', handle }).pipe(
        Effect.map((value) => value as ReadonlyArray<PendingEcho>),
        Effect.catch(threadDefect),
      ),
      owe: (echoes) => Effect.asVoid(ask({ _tag: 'Owe', handle, echoes })).pipe(Effect.catch(threadDefect)),
      close: () => {
        returned.delete(handle);
        post({ _tag: 'Close', handle });
      },
    };
    handles.set(terminal, handle);
    adoptedTerminals.add(terminal);
    return terminal;
  };

  const inputs: TerminalInputs = {
    open: Effect.fnUntraced(function* (terminal: Terminal, options: TerminalInputOptions) {
      const handle = handles.get(terminal);
      if (handle === undefined)
        return yield* Effect.die(new TerminalThreadUnavailable({ detail: 'this terminal was not adopted by the terminal thread' }));
      const held: Hosted = { options, rooms: new Map() };
      hosted.set(handle, held);
      yield* Effect.addFinalizer(() =>
        Effect.andThen(
          steady(ask({ _tag: 'Input', handle, ask: { _tag: 'Dispose' } })),
          Effect.sync(() => hosted.delete(handle)),
        ),
      );
      yield* ask({
        _tag: 'OpenInput',
        handle,
        limits: options.limits,
        ref: options.ref,
        carried: options.carried,
        output: offsetValue(options.output),
      }).pipe(Effect.catch(threadDefect));
      const input = (body: InputAsk): Effect.Effect<unknown, Failure> => ask({ _tag: 'Input', handle, ask: body });
      const fenced = (failure: Failure): Effect.Effect<never, InputFenced> =>
        failure._tag === 'InputFenced'
          ? Effect.fail(new InputFenced({ reason: failure.reason as InputFenced['reason'], detail: detailOf(failure) }))
          : threadDefect(failure);
      const settled = <A>(body: InputAsk): Effect.Effect<A> =>
        input(body).pipe(
          Effect.map((value) => value as A),
          Effect.catch(threadDefect),
        );
      const endpoint: TerminalEndpoint = {
        open: (binding) =>
          input({ _tag: 'OpenLane', binding }).pipe(
            Effect.map((value) => value as TerminalLane),
            Effect.catch((failure) =>
              failure._tag === 'LaneUnserved' ? Effect.fail(new LaneUnserved({ detail: detailOf(failure) })) : threadDefect(failure),
            ),
          ),
        close: (binding) => settled<void>({ _tag: 'EndLane', binding }),
      };
      const queue = {
        ref: options.ref,
        get frontier() {
          return settled<InputFrontier>({ _tag: 'Frontier' });
        },
        get pendingBytes() {
          return settled<number>({ _tag: 'PendingBytes' });
        },
        get pendingActs() {
          return settled<number>({ _tag: 'PendingActs' });
        },
        admit: (request, binding) =>
          input({ _tag: 'Admit', request, binding }).pipe(
            Effect.map((value) => value as InputAnswer),
            Effect.catch(fenced),
          ),
        next: (binding) => settled<InputSequence>({ _tag: 'Next', binding }),
        closeIntake: () => settled<void>({ _tag: 'CloseIntake' }),
        halt: (within) => settled<InputCarry>({ _tag: 'Halt', withinMs: Duration.toMillis(within) }),
        reply: (bytes, settling) =>
          input({ _tag: 'Reply', bytes, settling }).pipe(
            Effect.map((value): ReplyAnswer => {
              const answer = value as ReplyAnswered;
              if (answer._tag !== 'ReplyBackpressure') return answer;
              const room = answer.room;
              return { ...answer, room: room === undefined ? undefined : Deferred.await(roomOf(held, room)) };
            }),
            Effect.catch(fenced),
          ),
        endLanes: () => settled<void>({ _tag: 'EndLanes' }),
        closeLane: (binding, principal) => settled<void>({ _tag: 'CloseLane', binding, principal }),
        finish: () => settled<void>({ _tag: 'Finish' }),
        fence: (reason, detail) => settled<InputOwed>({ _tag: 'Fence', reason, detail }),
      } satisfies ExecutionInput;
      return { input: queue, endpoint } satisfies TerminalInput;
    }),
  };

  return { adopt, inputs } satisfies TerminalThread;
});
