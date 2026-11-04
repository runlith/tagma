import { Data, Deferred, Effect, Fiber, Result, Semaphore } from 'effect';
import type { Incarnation, NativeExit, ProcessCost } from '@runlith/executions/protocol/execution';
import { announced, type Served } from '@runlith/executions/protocol/capability';
import type { HolderLoss } from '@runlith/executions/protocol/runtime';
import {
  ChannelFailed,
  HolderRefused,
  HolderLaunchUncertain,
  Holder,
  type HeldChannels,
  type HeldExecution,
  type HeldLaunch,
  type HeldReap,
  type TransportDescriptors,
  type WorkState,
} from '../holder/Holder';
import * as frames from './frames';
import type { HeldPipe, HeldTerminal, Link, Owned } from './Link';

export class HolderUnavailable extends Data.TaggedError('HolderUnavailable')<{
  readonly detail: string;
}> {
  override get message(): string {
    return this.detail;
  }
}

type Act = HolderRefused['act'];
type Attached = {
  readonly pid: number;
  readonly handleLimit: number | 'absent';
  readonly expense: TransportDescriptors;
  readonly capabilities: Served;
  readonly held: ReadonlyArray<HeldExecution>;
};
type Pending = {
  readonly answer: Deferred.Deferred<frames.Message, HolderRefused | HolderLaunchUncertain>;
  readonly act: Act;
  readonly execution: string | undefined;
};
type Seen = { exit: NativeExit | undefined };
type Entry = {
  readonly exit: Deferred.Deferred<NativeExit, HolderRefused>;
  readonly seen: Seen;
  readonly owned: ReadonlyArray<Owned>;
  readonly terminal: HeldTerminal | undefined;
  readonly execution: HeldExecution;
};
type Greeting = {
  readonly pid: number;
  readonly handleLimit: number | 'absent';
  readonly expense: TransportDescriptors;
  readonly capabilities: Served;
  remaining: number;
  readonly held: Array<HeldExecution>;
};

const RECEIVE_BYTES = 65_536;
const GEOMETRY_LIMIT = 65_535;

const costOf = (usage: frames.Usage): ProcessCost => ({
  _tag: 'Measured',
  cpuMicros: usage.userMicros + usage.systemMicros,
  peakRssBytes: usage.peakRssBytes,
});

const lostRefusal = (act: Act, detail: string) => new HolderRefused({ act, reason: 'lost', detail });

const oversized = (spec: HeldLaunch): string | undefined => {
  if (spec.transport._tag !== 'pty') return undefined;
  const { rows, columns } = spec.transport.geometry;
  return rows > GEOMETRY_LIMIT || columns > GEOMETRY_LIMIT
    ? `a terminal of ${rows}x${columns} is larger than ${GEOMETRY_LIMIT}x${GEOMETRY_LIMIT}`
    : undefined;
};

export const connect = Effect.fn('Holder.connect')(function* (link: Link) {
  const scope = yield* Effect.scope;
  const sending = yield* Semaphore.make(1);
  const attached = Deferred.makeUnsafe<Attached, HolderUnavailable>();
  const gone = Deferred.makeUnsafe<HolderLoss>();
  const pending = new Map<number, Pending>();
  const entries = new Map<string, Entry>();
  const arrived: Array<number> = [];
  const aborting = new Map<string, Deferred.Deferred<void, HolderRefused>>();
  let requests = 0;
  let claim: number | undefined;
  let capabilities: Served = new Set();
  let greeting: Greeting | undefined;
  let generationValue: Incarnation | undefined;
  let lostWith: string | undefined;

  const listen = Effect.gen(function* () {
    const header = new Uint8Array(4);
    let body: Uint8Array | undefined;
    let filled = 0;
    let exhausted = false;
    for (;;) {
      const buffer = body ?? header;
      const landing = buffer.subarray(filled, Math.min(buffer.length, filled + RECEIVE_BYTES));
      const received = yield* link.receive(landing).pipe(
        Effect.match({
          onFailure: (failure) => {
            lose('gone', `the channel to the holder failed: ${failure.detail}`);
            return undefined;
          },
          onSuccess: (reception) => reception,
        }),
      );
      if (received === undefined) return;
      if (received.count === 0) return lose('gone', 'the holder closed its end of the channel');
      arrived.push(...received.handles);
      exhausted ||= received.capacity;
      filled += received.count;
      if (filled !== buffer.length) continue;
      if (body === undefined) {
        const length = new DataView(header.buffer).getUint32(0, true);
        if (length === 0 || length > frames.MAX_FRAME) return lose('broken', `the holder sent a frame of ${length} bytes`);
        body = new Uint8Array(length);
        filled = 0;
        continue;
      }
      let message: frames.Message;
      try {
        message = frames.decode(body);
      } catch (error) {
        return lose('broken', `the holder sent a frame this logic cannot read: ${String(error)}`);
      }
      const handles = [...arrived.splice(0), ...frames.handedOf(message)];
      if (exhausted && frames.carried(message) > 0) {
        for (const handle of handles) link.discard(handle);
        if (message._tag === 'launched') {
          const exited = Deferred.makeUnsafe<void, HolderRefused>();
          if (message.record.exit !== undefined) Deferred.doneUnsafe(exited, Effect.void);
          aborting.set(message.record.id, exited);
          yield* Effect.forkIn(
            rollback(message, exited).pipe(
              Effect.tapError((failure) => Effect.logError('the launch refused for handle capacity could not be rolled back', failure)),
            ),
            scope,
          );
        } else {
          Deferred.doneUnsafe(
            attached,
            Effect.fail(new HolderUnavailable({ detail: 'the logic has no handle capacity to receive the holder table' })),
          );
        }
      } else {
        const count = frames.carried(message);
        if (handles.length !== count) {
          for (const handle of handles) link.discard(handle);
          return lose('broken', `a ${message._tag} frame names ${count} handles and ${handles.length} arrived`);
        }
        dispatch(message, handles);
      }
      body = undefined;
      filled = 0;
      exhausted = false;
    }
  });

  const rollback = Effect.fn('Holder.rollback')(function* (
    message: Extract<frames.Message, { readonly _tag: 'launched' }>,
    exited: Deferred.Deferred<void, HolderRefused>,
  ) {
    const { request, record } = message;
    const complete = (detail: string, confirmed: boolean) =>
      Effect.sync(() => {
        const waiting = pending.get(request);
        pending.delete(request);
        if (confirmed) aborting.delete(record.id);
        if (waiting !== undefined)
          Deferred.doneUnsafe(
            waiting.answer,
            Effect.fail(
              confirmed
                ? new HolderRefused({ act: 'launch', reason: 'capacity', detail })
                : new HolderLaunchUncertain({ execution: record.id, detail }),
            ),
          );
      });
    yield* Effect.gen(function* () {
      yield* ask('act', (next) => frames.act(next, record.id, true, 'kill')).pipe(
        Effect.catchTag('HolderRefused', (failure) => (failure.reason === 'gone' ? Effect.void : Effect.fail(failure))),
      );
      const observed = yield* ask('observe', (next) => frames.observe(next, record.id));
      if (observed._tag !== 'done') return yield* unexpected('observe', observed);
      yield* Deferred.await(exited);
      const reaped = yield* ask('reap', (next) => frames.reap(next, record.id));
      if (reaped._tag !== 'reaped') return yield* unexpected('reap', reaped);
      const released = yield* ask('release', (next) => frames.release(next, record.id));
      if (released._tag !== 'done') return yield* unexpected('release', released);
      yield* complete('the logic had no handle capacity to receive the launched execution; the launch was rolled back', true);
    }).pipe(
      Effect.tapError((failure) =>
        complete(`the logic had no handle capacity; execution ${record.id} could not be rolled back: ${failure.detail}`, false),
      ),
    );
  }, Effect.uninterruptible);

  function dispatch(message: frames.Message, handles: ReadonlyArray<number>): void {
    switch (message._tag) {
      case 'hello': {
        claim = handles[0];
        generationValue = message.generation;
        capabilities = announced(message.capabilities);
        greeting = {
          pid: message.pid,
          handleLimit: message.handleLimit,
          expense: message.expense,
          capabilities,
          remaining: message.count,
          held: [],
        };
        return greeted();
      }
      case 'held': {
        const execution = executionOf(message.record, handles);
        if (greeting === undefined) return;
        greeting.held.push(execution);
        greeting.remaining -= 1;
        return greeted();
      }
      case 'exited': {
        const rollback = aborting.get(message.id);
        if (rollback !== undefined) Deferred.doneUnsafe(rollback, Effect.void);
        const entry = entries.get(message.id);
        if (entry === undefined || entry.seen.exit !== undefined) return;
        entry.seen.exit = message.exit;
        entry.terminal?.endInput();
        Deferred.doneUnsafe(entry.exit, Effect.succeed(message.exit));
        return;
      }
      default: {
        if (message._tag === 'launched') executionOf(message.record, handles);
        const waiting = pending.get(message.request);
        pending.delete(message.request);
        if (waiting !== undefined) Deferred.doneUnsafe(waiting.answer, Effect.succeed(message));
      }
    }
  }

  function greeted(): void {
    if (greeting === undefined || greeting.remaining > 0) return;
    const { pid, handleLimit, expense, capabilities, held } = greeting;
    Deferred.doneUnsafe(attached, Effect.succeed({ pid, handleLimit, expense, capabilities, held }));
  }

  function lose(reason: HolderLoss['reason'], detail: string): void {
    lostWith ??= detail;
    for (const waiting of pending.values())
      Deferred.doneUnsafe(
        waiting.answer,
        Effect.fail(
          waiting.execution === undefined
            ? lostRefusal(waiting.act, detail)
            : new HolderLaunchUncertain({ execution: waiting.execution, detail }),
        ),
      );
    pending.clear();
    for (const exiting of aborting.values()) Deferred.doneUnsafe(exiting, Effect.fail(lostRefusal('reap', detail)));
    aborting.clear();
    for (const entry of entries.values()) Deferred.doneUnsafe(entry.exit, Effect.fail(lostRefusal('exit', detail)));
    Deferred.doneUnsafe(attached, Effect.fail(new HolderUnavailable({ detail })));
    Deferred.doneUnsafe(gone, Effect.succeed({ reason, detail }));
    if (reason === 'broken') link.close();
  }

  const close = () => {
    for (const entry of entries.values()) {
      Deferred.doneUnsafe(entry.exit, Effect.fail(lostRefusal('exit', 'the logic closed its connection to the holder')));
      for (const owned of entry.owned) owned.close();
    }
    entries.clear();
    for (const handle of arrived.splice(0)) link.discard(handle);
    if (claim !== undefined) link.discard(claim);
    claim = undefined;
    link.close();
  };

  const ask = (act: Act, frame: (request: number) => Uint8Array): Effect.Effect<frames.Message, HolderRefused> =>
    request(act, frame).pipe(
      Effect.mapError((failure) => (failure instanceof HolderLaunchUncertain ? lostRefusal(act, failure.detail) : failure)),
    );

  const request = Effect.fn('Holder.request')(function* (act: Act, frame: (request: number) => Uint8Array, execution?: string) {
    if (lostWith !== undefined) return yield* lostRefusal(act, lostWith);
    requests += 1;
    const request = requests;
    const bytes = frame(request);
    if (bytes.length - 4 > frames.MAX_FRAME) {
      return yield* new HolderRefused({
        act,
        reason: 'invalid',
        detail: `the request takes ${bytes.length} bytes, and the holder reads frames of ${frames.MAX_FRAME} at most`,
      });
    }
    const answer = Deferred.makeUnsafe<frames.Message, HolderRefused | HolderLaunchUncertain>();
    pending.set(request, { answer, act, execution });
    yield* Effect.uninterruptible(sending.withPermits(1)(sendAll(bytes))).pipe(
      Effect.catchTag('ChannelFailed', (failure) => {
        pending.delete(request);
        const detail = `the request could not be written: ${failure.detail}`;
        return Effect.fail(execution === undefined ? lostRefusal(act, detail) : new HolderLaunchUncertain({ execution, detail }));
      }),
    );
    const message = yield* Deferred.await(answer).pipe(
      Effect.mapError((failure) =>
        failure instanceof HolderLaunchUncertain || failure.act === act ? failure : new HolderRefused({ ...failure, act }),
      ),
    );
    if (message._tag === 'refused') return yield* new HolderRefused({ act, reason: message.reason, detail: message.detail });
    return message;
  });

  const sendAll = Effect.fnUntraced(function* (bytes: Uint8Array) {
    let offset = 0;
    while (offset < bytes.length) offset += yield* link.write(bytes.subarray(offset));
  });

  const unexpected = (act: Act, message: frames.Message) =>
    new HolderRefused({ act, reason: 'invalid', detail: `the holder answered ${message._tag}` });

  const unsupported = (act: Act, detail: string) => Effect.fail(new HolderRefused({ act, reason: 'unsupported', detail }));

  function executionOf(row: frames.Row, handles: ReadonlyArray<number>): HeldExecution {
    const exit = Deferred.makeUnsafe<NativeExit, HolderRefused>();
    const seen: Seen = { exit: row.exit };
    const leader = { reaped: row.usage !== undefined };
    let reaped: HeldReap | undefined =
      row.usage === undefined || row.exit === undefined ? undefined : { exit: row.exit, cost: costOf(row.usage) };
    const { channels, owned, input, stdout, stderr, terminal } = channelsOf(row, handles);
    if (seen.exit !== undefined) {
      terminal?.endInput();
      Deferred.doneUnsafe(exit, Effect.succeed(seen.exit));
    }
    let workState: WorkState = 'unmeasured';
    const done = (act: Act) => (message: frames.Message) => (message._tag === 'done' ? Effect.void : Effect.fail(unexpected(act, message)));
    const lifecycle = Semaphore.makeUnsafe(1);
    let released = false;
    const execution: HeldExecution = {
      id: row.id,
      pid: row.pid,
      work: row.work,
      birth: row.birth,
      terminal: row.terminal,
      pace: row.pace,
      channels,
      exit: Deferred.await(exit),
      observed: Effect.sync(() => seen.exit),
      observe: Effect.suspend(() =>
        seen.exit !== undefined
          ? Effect.succeed(seen.exit)
          : Effect.flatMap(
              ask('observe', (request) => frames.observe(request, row.id)),
              (message) => Effect.as(done('observe')(message), seen.exit),
            ),
      ),
      workState: lifecycle.withPermits(1)(
        Effect.suspend(() => {
          if (leader.reaped || lostWith !== undefined) return Effect.succeed(workState === 'ended' ? 'ended' : 'unmeasured');
          return Effect.map(link.workState(row.work, row.pid, seen.exit !== undefined), (read): WorkState => {
            if (leader.reaped || lostWith !== undefined) return workState === 'ended' ? 'ended' : 'unmeasured';
            workState = read;
            return read;
          });
        }),
      ),
      get reaped() {
        return reaped;
      },
      act: (target, step) =>
        row.transport === 'pipes' && (step === 'interrupt' || step === 'terminate') && !capabilities.has('pipe-graceful-stop')
          ? unsupported('act', 'the holder delivers no graceful stop to pipes')
          : Effect.flatMap(
              ask('act', (request) => frames.act(request, row.id, target === 'work', step)),
              done('act'),
            ),
      signal: (to, name) =>
        Effect.suspend(() =>
          capabilities.has('named-signals')
            ? Effect.flatMap(
                ask('signal', (request) => frames.signal(request, row.id, to === 'work', name)),
                done('signal'),
              )
            : unsupported('signal', 'the holder delivers no named signals'),
        ),
      closeInput: Effect.uninterruptible(
        lifecycle.withPermits(1)(
          Effect.gen(function* () {
            const answer = yield* ask('close-input', (request) => frames.closeInput(request, row.id)).pipe(
              Effect.tapError((failure) =>
                Effect.sync(() => {
                  if (failure.reason === 'lost') input?.close();
                }),
              ),
            );
            yield* done('close-input')(answer);
            input?.close();
          }),
        ),
      ),
      closeOutput: Effect.suspend(() =>
        row.transport === 'pty'
          ? execution.closeInput
          : Effect.gen(function* () {
              const out = yield* Effect.result(closePipe(row.id, 'stdout', stdout));
              const err = yield* Effect.result(closePipe(row.id, 'stderr', stderr));
              if (Result.isFailure(out)) return yield* out.failure;
              if (Result.isFailure(err)) return yield* err.failure;
            }),
      ),
      reap: Effect.uninterruptible(
        lifecycle.withPermits(1)(
          Effect.flatMap(
            ask('reap', (request) => frames.reap(request, row.id)),
            (message) => {
              if (message._tag !== 'reaped') return Effect.fail(unexpected('reap', message));
              leader.reaped = true;
              reaped = { exit: message.exit, cost: costOf(message.usage) };
              return Effect.succeed(reaped);
            },
          ),
        ),
      ),
      release: Effect.uninterruptible(
        lifecycle.withPermits(1)(
          Effect.gen(function* () {
            if (released) return;
            yield* ask('release', (request) => frames.release(request, row.id)).pipe(
              Effect.flatMap(done('release')),
              Effect.catchTag('HolderRefused', (failure) => (failure.reason === 'lost' ? Effect.void : Effect.fail(failure))),
            );
            released = true;
            for (const each of owned) each.close();
            entries.delete(row.id);
            if (seen.exit === undefined)
              Deferred.doneUnsafe(
                exit,
                Effect.fail(
                  new HolderRefused({
                    act: 'exit',
                    reason: 'unknown',
                    detail: 'the execution was released before its exit was observed',
                  }),
                ),
              );
          }),
        ),
      ),
    };
    entries.set(row.id, { exit, seen, owned, terminal, execution });
    return execution;
  }

  const closePipe = Effect.fnUntraced(function* (id: string, stream: 'stdout' | 'stderr', pipe: Owned | undefined) {
    const answer = yield* ask('close-output', (request) => frames.closeOutput(request, id, stream)).pipe(
      Effect.tapError((failure) =>
        Effect.sync(() => {
          if (failure.reason === 'lost') pipe?.close();
        }),
      ),
    );
    if (answer._tag !== 'done') return yield* unexpected('close-output', answer);
    pipe?.close();
  }, Effect.uninterruptible);

  function channelsOf(
    row: frames.Row,
    handles: ReadonlyArray<number>,
  ): {
    readonly channels: HeldChannels;
    readonly owned: ReadonlyArray<Owned>;
    readonly input: Owned | undefined;
    readonly stdout: HeldPipe | undefined;
    readonly stderr: HeldPipe | undefined;
    readonly terminal: HeldTerminal | undefined;
  } {
    if (row.transport === 'pty') {
      const terminal = handles.length === 0 ? undefined : link.terminal(handles);
      const owned = terminal === undefined ? [] : [terminal];
      return { channels: { _tag: 'pty', terminal }, owned, input: terminal, stdout: undefined, stderr: undefined, terminal };
    }
    let at = 0;
    const stdout = (row.handleMask & 1) === 0 ? undefined : link.pipe(handles[at++]!);
    const stderr = (row.handleMask & 2) === 0 ? undefined : link.pipe(handles[at++]!);
    const stdin = (row.handleMask & 4) === 0 ? undefined : link.pipe(handles[at]!);
    const output = (stream: 'stdout' | 'stderr', pipe: HeldPipe | undefined) => {
      let ended = pipe === undefined;
      return {
        read: (limit?: number) =>
          Effect.suspend(() =>
            ended
              ? Effect.succeed(undefined)
              : Effect.flatMap(pipe!.read(limit), (chunk) =>
                  chunk !== undefined
                    ? Effect.succeed(chunk)
                    : Effect.as(
                        closePipe(row.id, stream, pipe).pipe(
                          Effect.catchTag('HolderRefused', (failure) => (failure.reason === 'lost' ? Effect.void : Effect.fail(failure))),
                          Effect.mapError((failure) => new ChannelFailed({ reason: 'os', detail: failure.detail })),
                          Effect.tap(() =>
                            Effect.sync(() => {
                              ended = true;
                            }),
                          ),
                        ),
                        undefined,
                      ),
                ),
          ),
        stopReading: pipe === undefined ? Effect.void : pipe.stopReading,
      };
    };
    const owned = [stdout, stderr, stdin].filter((pipe): pipe is HeldPipe => pipe !== undefined);
    return {
      channels: {
        _tag: 'pipes',
        stdout: output('stdout', stdout),
        stderr: output('stderr', stderr),
        stdin: stdin === undefined ? undefined : { write: (bytes) => stdin.write(bytes), stopWriting: stdin.stopWriting },
        input: row.input,
      },
      owned,
      input: stdin,
      stdout,
      stderr,
      terminal: undefined,
    };
  }

  yield* Effect.acquireRelease(Effect.forkDetach(listen), (listening) =>
    Effect.flatMap(Fiber.interrupt(listening), () => Effect.sync(close)),
  );
  const attachedTo = yield* Deferred.await(attached);
  return Holder.of({
    pid: attachedTo.pid,
    generation: Effect.sync(() => generationValue),
    bindGeneration: (generation) => {
      if (!Number.isSafeInteger(generation) || generation < 0)
        return Effect.fail(
          new HolderRefused({ act: 'bind-generation', reason: 'invalid', detail: 'the generation is not a nonnegative wire integer' }),
        );
      return Effect.uninterruptible(
        Effect.flatMap(
          ask('bind-generation', (request) => frames.bindGeneration(request, generation)),
          (message) =>
            message._tag === 'done'
              ? Effect.sync(() => {
                  generationValue = generation;
                })
              : Effect.fail(unexpected('bind-generation', message)),
        ),
      );
    },
    capabilities: attachedTo.capabilities,
    descriptors: { limit: attachedTo.handleLimit, expense: attachedTo.expense, copies: link.copies },
    held: attachedTo.held,
    launch: (spec) =>
      Effect.flatMap(link.prepare(spec), (prepared) => {
        const unfit = oversized(prepared);
        if (unfit !== undefined) return Effect.fail(new HolderRefused({ act: 'launch', reason: 'invalid', detail: unfit }));
        return Effect.uninterruptible(
          Effect.flatMap(
            request('launch', (request) => frames.launch(request, prepared), prepared.id),
            (message) => {
              const entry = message._tag === 'launched' ? entries.get(message.record.id) : undefined;
              if (entry !== undefined) return Effect.succeed(entry.execution);
              const detail = `the holder answered ${message._tag} with no execution`;
              lose('broken', detail);
              return Effect.fail(new HolderLaunchUncertain({ execution: prepared.id, detail }));
            },
          ),
        );
      }),
    pace: (processes) =>
      Effect.flatMap(
        ask('pace', (request) => frames.pace(request, processes)),
        (message) =>
          message._tag === 'paced' && message.kept.length === processes.length
            ? Effect.succeed(message.kept)
            : Effect.fail(unexpected('pace', message)),
      ),
    ready: Effect.suspend(() =>
      Effect.flatMap(ask('ready', frames.ready), (message) =>
        message._tag === 'done' ? Effect.void : Effect.fail(unexpected('ready', message)),
      ),
    ),
    vacate: Effect.suspend(() =>
      Effect.flatMap(ask('vacate', frames.vacate), (message) =>
        message._tag === 'done' ? Effect.void : Effect.fail(unexpected('vacate', message)),
      ),
    ),
    prepare: (next) =>
      Effect.suspend(() =>
        capabilities.has('holder-replaces-itself')
          ? Effect.flatMap(
              ask('prepare', (request) => frames.prepare(request, next)),
              (message) => (message._tag === 'done' ? Effect.void : Effect.fail(unexpected('prepare', message))),
            )
          : unsupported('prepare', 'the holder does not replace itself'),
      ),
    activate: Effect.suspend(() =>
      capabilities.has('holder-replaces-itself')
        ? Effect.flatMap(ask('activate', frames.activate), (message) =>
            message._tag === 'done' ? Effect.void : Effect.fail(unexpected('activate', message)),
          )
        : unsupported('activate', 'the holder does not replace itself'),
    ),
    lost: Deferred.await(gone),
  });
});
