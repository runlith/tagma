import { Data, Deferred, Effect, Ref, Scope, Semaphore } from 'effect';
import { Terminal, type IDisposable } from '@xterm/headless';
import type { ScreenAppearance, TerminalColors } from '@runlith/executions/protocol/appearance';
import type { ExecutionLimits } from '@runlith/executions/protocol/capacity';
import type { ExecutionRef } from '@runlith/executions/protocol/execution';
import type { InputProfile } from '@runlith/executions/protocol/inputProfile';
import { byteOffset, offsetValue, type ByteOffset, type TerminalGeometry } from '@runlith/executions/protocol/record';
import { makeAppearance } from './Appearance';
import { makeInputModes, type InputProfileConflict } from './InputModes';
import { reportDeadFiber } from './hostTelemetry';
import { StringGuard } from './payloadGuard';
import { checkpointPieces, relink, type ScreenCheckpoint } from './ScreenCheckpoint';

export class InterpretationMissing extends Data.TaggedError('InterpretationMissing')<{}> {
  override get message(): string {
    return 'the execution has no terminal interpretation';
  }
}
export const INTERPRETATION_REASONS = ['engine', 'profile', 'budget', 'closed', 'checkpoint'] as const;
export class InterpretationUnavailable extends Data.TaggedError('InterpretationUnavailable')<{
  readonly reason: (typeof INTERPRETATION_REASONS)[number];
  readonly parsedThrough: ByteOffset;
  readonly detail: string;
}> {
  override get message(): string {
    return this.detail;
  }
}
export class CheckpointUnwritable extends Data.TaggedError('CheckpointUnwritable')<{
  readonly parsedThrough: ByteOffset;
  readonly detail: string;
}> {
  override get message(): string {
    return this.detail;
  }
}
export type RestorePoint =
  | { readonly _tag: 'Checkpoint'; readonly checkpoint: ScreenCheckpoint; readonly frontier: ByteOffset }
  | { readonly _tag: 'Lost'; readonly geometry: TerminalGeometry; readonly failure: InterpretationUnavailable };
export type Burst = {
  readonly parsed: ByteOffset;
  readonly retained: number;
  readonly checkpoint: ScreenCheckpoint | CheckpointUnwritable | undefined;
};
export type ReplySink = (bytes: Uint8Array, settling: boolean) => Effect.Effect<ReplyDelivery>;
export type ReplyDelivery = {
  readonly delivered: boolean;
  readonly ending: boolean;
  readonly detail: string;
  readonly room?: Effect.Effect<void> | undefined;
};
export type Interpreted<A> = {
  readonly value: A;
  readonly parsedThrough: ByteOffset;
  readonly appearance: ScreenAppearance;
  readonly input: InputProfile;
};
export type Interpretation = {
  readonly ref: ExecutionRef;
  readonly engine: Terminal;
  readonly parsedThrough: Effect.Effect<ByteOffset>;
  readonly layout: number;
  readonly feed: (bytes: Uint8Array) => Effect.Effect<ByteOffset, InterpretationUnavailable>;
  readonly burst: (bytes: Uint8Array) => Effect.Effect<Burst, InterpretationUnavailable>;
  readonly checkpoint: () => Effect.Effect<ScreenCheckpoint | undefined, InterpretationUnavailable | CheckpointUnwritable>;
  readonly point: (history: number) => Effect.Effect<ScreenCheckpoint | undefined, InterpretationUnavailable | CheckpointUnwritable>;
  readonly read: <A>(f: (engine: Terminal) => A) => Effect.Effect<Interpreted<A>, InterpretationUnavailable>;
  readonly resize: (geometry: TerminalGeometry, at: ByteOffset) => Effect.Effect<void, InterpretationUnavailable>;
  readonly profile: () => Effect.Effect<InputProfile>;
  readonly retained: () => Effect.Effect<number>;
  readonly historyRows: () => Effect.Effect<number>;
  readonly trim: (rows: number) => Effect.Effect<number>;
  readonly reset: () => Effect.Effect<void, InterpretationUnavailable>;
  readonly unavailable: Effect.Effect<InterpretationUnavailable | undefined>;
  readonly requireProfile: (revision: number) => Effect.Effect<void, InterpretationUnavailable | InputProfileConflict>;
  readonly settleReplies: Effect.Effect<void>;
};
type Opening = {
  readonly ref: ExecutionRef;
  readonly limits: ExecutionLimits;
  readonly colors: TerminalColors;
  readonly reply: ReplySink;
  readonly history?: number;
} & ({ readonly mode: 'open'; readonly geometry: TerminalGeometry } | { readonly mode: 'restore'; readonly point: RestorePoint });
const encoder = new TextEncoder();

export const makeInterpretation = Effect.fnUntraced(function* (
  opening: Opening,
): Effect.fn.Return<Interpretation, InterpretationUnavailable, Scope.Scope> {
  const { ref, limits, colors, reply } = opening;
  const geometry =
    opening.mode === 'open' ? opening.geometry : opening.point._tag === 'Lost' ? opening.point.geometry : opening.point.checkpoint.geometry;
  const allowance = payloadAllowance(limits);
  if (allowance <= 0)
    return yield* new InterpretationUnavailable({
      reason: 'profile',
      parsedThrough: byteOffset(0n),
      detail: `parser.pendingBytes ${limits.parser.pendingBytes} cannot hold the engine's own parse buffer of ${4 * limits.output.landingBytes} bytes`,
    });
  const storage = dynamicStorage(limits, geometry);
  if (typeof storage === 'string')
    return yield* new InterpretationUnavailable({ reason: 'profile', parsedThrough: byteOffset(0n), detail: storage });
  const engine = yield* Effect.acquireRelease(
    Effect.try({
      try: () =>
        new Terminal({
          cols: geometry.columns,
          rows: geometry.rows,
          scrollback: Math.min(opening.history ?? limits.geometry.scrollbackRows, limits.geometry.scrollbackRows),
          allowProposedApi: true,
          windowOptions: {},
          vtExtensions: { kittyKeyboard: true, kittySgrBoldFaintControl: false, win32InputMode: false, colorSchemeQuery: false },
          dynamicStorage: storage,
        }),
      catch: (cause) => new InterpretationUnavailable({ reason: 'engine', parsedThrough: byteOffset(0n), detail: String(cause) }),
    }),
    (terminal) => Effect.sync(() => terminal.dispose()),
  );
  if (engine.dynamicStorage === undefined)
    return yield* new InterpretationUnavailable({
      reason: 'engine',
      parsedThrough: byteOffset(0n),
      detail:
        'the engine build carries no dynamic-storage bound, so its combined-character, extended-attribute and link stores grow with the child',
    });

  let failure: InterpretationUnavailable | undefined;
  let parsed = 0n;
  let checkpointed = 0n;
  let silentThrough = 0n;
  let silent = false;
  let laidOut = 0;
  const regrids: Regrid[] = [];
  const replies: Uint8Array[] = [];
  let repliesBytes = 0;
  let waiting: Deferred.Deferred<void> | undefined;
  let settled = false;
  const permit = yield* Ref.make<Deferred.Deferred<void> | undefined>(undefined);
  const delivering = yield* Semaphore.make(1);
  const guard = new StringGuard();

  const push = (bytes: Uint8Array): void => {
    if (bytes.length === 0 || silent) return;
    if (repliesBytes + bytes.length > limits.input.pendingBytes) {
      failure ??= new InterpretationUnavailable({
        reason: 'budget',
        parsedThrough: byteOffset(parsed),
        detail: `a ${bytes.length}-byte reply did not fit the ${limits.input.pendingBytes}-byte input budget; the application's query is unanswerable`,
      });
      return;
    }
    replies.push(bytes);
    repliesBytes += bytes.length;
    const wake = waiting;
    waiting = undefined;
    if (wake !== undefined) Deferred.doneUnsafe(wake, Effect.void);
  };
  const appearance = yield* makeAppearance({ terminal: engine, base: colors, reply: push }).pipe(
    Effect.mapError(
      (unavailable) =>
        new InterpretationUnavailable({ reason: 'engine', parsedThrough: byteOffset(0n), detail: String(unavailable.cause) }),
    ),
  );
  const modes = yield* makeInputModes({ terminal: engine, profile: 'xterm-256color-unicode11' }).pipe(
    Effect.mapError(
      (unavailable) => new InterpretationUnavailable({ reason: 'profile', parsedThrough: byteOffset(0n), detail: unavailable.reason }),
    ),
  );
  const held = (): number => {
    const storage = engine.dynamicStorage;
    if (storage === undefined) throw new Error('the engine build carries no dynamic-storage accountant');
    const lines = engine.buffer.normal.length + engine.buffer.alternate.length;
    return lines * engine.cols * CELL_BYTES + storage.lineBytes + storage.linkBytes;
  };
  const broke = (reason: InterpretationUnavailable['reason'], detail: string): Effect.Effect<never, InterpretationUnavailable> => {
    failure ??= new InterpretationUnavailable({ reason, parsedThrough: byteOffset(parsed), detail });
    return failure;
  };
  const exclusive = <A, E>(work: Effect.Effect<A, E>): Effect.Effect<A, E> =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        for (;;) {
          const held = yield* Ref.modify(permit, (standing) =>
            standing === undefined ? ([undefined, Deferred.makeUnsafe<void>()] as const) : ([standing, standing] as const),
          );
          if (held === undefined) break;
          yield* restore(Deferred.await(held));
        }
        return yield* restore(work).pipe(
          Effect.ensuring(
            Effect.flatMap(Ref.getAndSet(permit, undefined), (taken) =>
              taken === undefined ? Effect.void : Effect.asVoid(Deferred.succeed(taken, undefined)),
            ),
          ),
        );
      }),
    );
  const written = (bytes: Uint8Array, quiet: boolean): Effect.Effect<void> =>
    Effect.callback<void>((resume) => {
      silent = quiet;
      engine.write(bytes, () => {
        silent = false;
        resume(Effect.void);
      });
    });
  const reflowed = Effect.fnUntraced(function* (geometry: TerminalGeometry, storage: DynamicStorage) {
    yield* Effect.try({
      try: () => {
        laidOut++;
        engine.options.dynamicStorage = storage;
        engine.resize(geometry.columns, geometry.rows);
      },
      catch: (cause) => new InterpretationUnavailable({ reason: 'engine', parsedThrough: byteOffset(parsed), detail: String(cause) }),
    });
    const refusal = engine.dynamicStorage?.refusal;
    if (refusal !== undefined)
      return yield* broke(
        'budget',
        `reflowing to ${geometry.columns}×${geometry.rows} would hold ${refusal.bytes} bytes of ${refusal.store} storage against the ${refusal.limit} this profile declared`,
      );
  });
  const laid = Effect.fnUntraced(function* (position: bigint) {
    for (let next = regrids[0]; next !== undefined && next.at <= position; next = regrids[0]) {
      regrids.shift();
      parsed = position;
      yield* reflowed(next.geometry, next.storage);
    }
  });
  const applied = Effect.fnUntraced(function* (bytes: Uint8Array) {
    if (failure !== undefined) return yield* failure;
    const verdict = guard.admit(bytes, payloadAllowance(limits));
    const accepted = verdict.accepted === bytes.length ? bytes : bytes.subarray(0, verdict.accepted);
    if (accepted.length > 0) {
      const frontier = parsed;
      for (let done = 0; done < accepted.length;) {
        const position = frontier + BigInt(done);
        yield* laid(position);
        const quiet = silentThrough > position;
        let end = accepted.length;
        const next = regrids[0];
        if (next !== undefined && next.at - frontier < BigInt(end)) end = Number(next.at - frontier);
        if (quiet && silentThrough - frontier < BigInt(end)) end = Number(silentThrough - frontier);
        yield* written(accepted.subarray(done, end), quiet);
        done = end;
      }
      yield* laid(frontier + BigInt(accepted.length));
      const refusal = engine.dynamicStorage?.refusal;
      if (refusal !== undefined) {
        parsed = frontier;
        return yield* broke(
          'budget',
          `the engine's ${refusal.store} storage would hold ${refusal.bytes} bytes against the ${refusal.limit} this profile declared`,
        );
      }
      parsed = frontier + BigInt(accepted.length);
    }
    if (verdict.accepted < bytes.length)
      return yield* broke(
        'budget',
        `an unterminated string sequence stands at ${verdict.open} bytes against a payload allowance of ${payloadAllowance(limits)}`,
      );
    return byteOffset(parsed);
  });
  const composed = Effect.fnUntraced(function* (history: number) {
    const position = byteOffset(parsed);
    const shown = yield* appearance
      .checkpoint()
      .pipe(Effect.mapError((unavailable) => new CheckpointUnwritable({ parsedThrough: position, detail: String(unavailable.cause) })));
    const pieces = checkpointPieces(engine, shown, crypto.randomUUID(), history);
    const budget = held() + limits.parser.pendingBytes;
    const bytes: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const piece = yield* Effect.try({
        try: () => pieces.next(),
        catch: (cause) => new CheckpointUnwritable({ parsedThrough: position, detail: String(cause) }),
      });
      if (piece.done === true) return { position, geometry: { rows: engine.rows, columns: engine.cols }, links: piece.value, bytes };
      const encoded = encoder.encode(piece.value);
      size += encoded.length;
      if (size > budget)
        return yield* new CheckpointUnwritable({
          parsedThrough: position,
          detail: `the checkpoint passed ${size} bytes against the ${budget} the screen it describes holds`,
        });
      bytes.push(encoded);
      yield* Effect.yieldNow;
    }
  });
  const taken = Effect.fnUntraced(function* () {
    if (engine.parseState?.rest !== true) return undefined;
    checkpointed = parsed;
    return yield* composed(Number.POSITIVE_INFINITY);
  });

  const feed = (bytes: Uint8Array) => exclusive(applied(bytes));
  const burst = Effect.fnUntraced(function* (bytes: Uint8Array): Effect.fn.Return<Burst, InterpretationUnavailable> {
    const through = yield* applied(bytes);
    const due = parsed - checkpointed >= BigInt(Math.floor(limits.output.retainedBytes / 2));
    const checkpoint = due ? yield* Effect.result(taken()) : undefined;
    return {
      parsed: through,
      retained: held(),
      checkpoint: checkpoint === undefined ? undefined : checkpoint._tag === 'Success' ? checkpoint.success : checkpoint.failure,
    };
  }, exclusive);
  const checkpoint = Effect.fnUntraced(function* () {
    if (failure !== undefined) return yield* failure;
    return yield* taken();
  }, exclusive);
  const point = Effect.fnUntraced(function* (history: number) {
    if (failure !== undefined) return yield* failure;
    if (engine.parseState?.rest !== true) return undefined;
    return yield* composed(history);
  }, exclusive);
  const read = Effect.fnUntraced(function* <A>(f: (engine: Terminal) => A): Effect.fn.Return<Interpreted<A>, InterpretationUnavailable> {
    if (failure !== undefined) return yield* failure;
    const shown = yield* appearance.snapshot().pipe(
      Effect.mapError(
        (unavailable) =>
          new InterpretationUnavailable({
            reason: 'engine',
            parsedThrough: byteOffset(parsed),
            detail: String(unavailable.cause),
          }),
      ),
    );
    const input = yield* modes.snapshot();
    const value = yield* Effect.try({
      try: () => f(engine),
      catch: (cause) => new InterpretationUnavailable({ reason: 'engine', parsedThrough: byteOffset(parsed), detail: String(cause) }),
    });
    return { value, parsedThrough: byteOffset(parsed), appearance: shown, input };
  }, exclusive);
  const resize = Effect.fnUntraced(function* (geometry: TerminalGeometry, at: ByteOffset) {
    if (failure !== undefined) return yield* failure;
    const storage = dynamicStorage(limits, geometry);
    if (typeof storage === 'string') return yield* broke('profile', storage);
    regrids.push({ at: offsetValue(at), geometry, storage });
    yield* laid(parsed);
  }, exclusive);
  const reset = Effect.fnUntraced(function* () {
    if (failure !== undefined) return yield* failure;
    yield* Effect.try({
      try: () => {
        laidOut++;
        engine.reset();
      },
      catch: (cause) => new InterpretationUnavailable({ reason: 'engine', parsedThrough: byteOffset(parsed), detail: String(cause) }),
    });
    guard.reset();
    yield* appearance.reset();
    yield* modes.reset();
  }, exclusive);
  const requireProfile = Effect.fnUntraced(function* (revision: number) {
    if (failure !== undefined) return yield* failure;
    yield* modes
      .require(revision)
      .pipe(
        Effect.mapError((unavailable) =>
          unavailable._tag === 'InputProfileConflict'
            ? unavailable
            : new InterpretationUnavailable({ reason: 'profile', parsedThrough: byteOffset(parsed), detail: unavailable.reason }),
        ),
      );
  });
  const hand = Effect.fnUntraced(function* (settling: boolean) {
    const next = replies[0];
    if (next === undefined) return undefined;
    const delivered = yield* reply(next, settling);
    if (!delivered.delivered && !delivered.ending && delivered.room !== undefined && !settling) return delivered.room;
    replies.shift();
    repliesBytes -= next.length;
    if (!delivered.delivered && !delivered.ending)
      failure ??= new InterpretationUnavailable({
        reason: 'budget',
        parsedThrough: byteOffset(parsed),
        detail: `a ${next.length}-byte reply was refused by input admission: ${delivered.detail}`,
      });
    return undefined;
  });
  const settleReplies = Effect.gen(function* () {
    settled = true;
    const wake = waiting;
    waiting = undefined;
    if (wake !== undefined) Deferred.doneUnsafe(wake, Effect.void);
    while (replies.length > 0) yield* hand(true);
  }).pipe(delivering.withPermits(1));
  const deliver = Effect.gen(function* () {
    for (;;) {
      if (settled) return;
      if (replies.length === 0) {
        const wake = Deferred.makeUnsafe<void>();
        waiting = wake;
        if (replies.length === 0 && !settled) yield* Deferred.await(wake);
        waiting = undefined;
        continue;
      }
      const room = yield* delivering.withPermits(1)(Effect.suspend(() => (settled ? Effect.succeed(undefined) : hand(false))));
      if (room === undefined || settled) continue;
      const wake = Deferred.makeUnsafe<void>();
      waiting = wake;
      if (!settled) yield* Effect.raceFirst(room, Deferred.await(wake));
      waiting = undefined;
    }
  }).pipe(
    Effect.catchDefect((defect) =>
      Effect.gen(function* () {
        failure ??= new InterpretationUnavailable({ reason: 'engine', parsedThrough: byteOffset(parsed), detail: String(defect) });
        return yield* Effect.die(defect);
      }),
    ),
  );

  yield* register(() => engine.parser.registerOscHandler(52, () => true));
  yield* register(() => engine.onData((data) => push(encoder.encode(data))));
  yield* register(() => engine.onBinary((data) => push(binary(data))));
  yield* Effect.forkScoped(reportDeadFiber('interpretation-deliver', deliver));
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      failure ??= new InterpretationUnavailable({ reason: 'closed', parsedThrough: byteOffset(parsed), detail: 'the execution ended' });
    }),
  );

  if (opening.mode === 'restore') {
    const point = opening.point;
    if (point._tag === 'Lost') {
      parsed = offsetValue(point.failure.parsedThrough);
      failure = point.failure;
    } else {
      const { checkpoint, frontier } = point;
      for (const piece of checkpoint.bytes)
        for (let at = 0; at < piece.length; at += limits.output.landingBytes) {
          yield* written(piece.subarray(at, at + limits.output.landingBytes), true);
        }
      relink(engine, checkpoint.links);
      const refusal = engine.dynamicStorage?.refusal;
      if (refusal !== undefined)
        return yield* new InterpretationUnavailable({
          reason: 'budget',
          parsedThrough: checkpoint.position,
          detail: `the checkpoint's ${refusal.store} storage would hold ${refusal.bytes} bytes against the ${refusal.limit} this profile declared`,
        });
      parsed = offsetValue(checkpoint.position);
      checkpointed = parsed;
      silentThrough = offsetValue(frontier);
    }
  }
  return {
    ref,
    engine,
    parsedThrough: Effect.sync(() => byteOffset(parsed)),
    get layout() {
      return laidOut;
    },
    feed,
    burst,
    checkpoint,
    point,
    read,
    resize,
    profile: modes.snapshot,
    retained: () => exclusive(Effect.sync(held)),
    historyRows: () => exclusive(Effect.sync(() => engine.buffer.normal.baseY)),
    trim: (rows: number) =>
      exclusive(
        Effect.sync(() => {
          if (engine.trimHistory === undefined) throw new Error('the engine build carries no history trim door');
          return engine.trimHistory(rows);
        }),
      ),
    reset,
    unavailable: Effect.sync(() => failure),
    requireProfile,
    settleReplies,
  };
});

const payloadAllowance = (limits: ExecutionLimits): number => Math.floor((limits.parser.pendingBytes - 4 * limits.output.landingBytes) / 2);
const COMBINED_ENTRY_BYTES = 32;
const EXTENDED_ENTRY_BYTES = 48;
const LINK_ENTRY_BYTES = 96;
const LINK_MARKER_BYTES = 512;
const LINK_URI_UNITS = 256;
const CELL_BYTES = 12;
const LINK_SHARE = 16;
const REFLOW_LAYOUTS = 2;
type DynamicStorage = { readonly lineBytes: number; readonly linkBytes: number };
type Regrid = { readonly at: bigint; readonly geometry: TerminalGeometry; readonly storage: DynamicStorage };
const dynamicStorage = (limits: ExecutionLimits, geometry: TerminalGeometry): DynamicStorage | string => {
  const lines = geometry.rows + limits.geometry.scrollbackRows + geometry.rows;
  const fixed = REFLOW_LAYOUTS * lines * geometry.columns * CELL_BYTES;
  const dynamic = limits.parser.cellBytes - fixed;
  if (dynamic <= 0)
    return `parser.cellBytes ${limits.parser.cellBytes} leaves nothing beside the ${fixed} bytes of cell arrays the two layouts of a resize hold for ${lines} lines of ${geometry.columns} columns`;
  const linkBytes = Math.min(lines * (LINK_ENTRY_BYTES + LINK_MARKER_BYTES + 2 * LINK_URI_UNITS), Math.floor(dynamic / LINK_SHARE));
  const lineBytes = Math.floor((dynamic - linkBytes) / (REFLOW_LAYOUTS * lines));
  const floor = geometry.columns * Math.max(EXTENDED_ENTRY_BYTES, COMBINED_ENTRY_BYTES + 2 * 2);
  if (linkBytes <= 0 || lineBytes < floor)
    return `parser.cellBytes ${limits.parser.cellBytes} leaves a line ${lineBytes} bytes of dynamic storage against the ${floor} one decoration a column needs`;
  return { lineBytes, linkBytes };
};
const register = <A extends IDisposable>(acquire: () => A): Effect.Effect<A, InterpretationUnavailable, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.try({
      try: acquire,
      catch: (cause) => new InterpretationUnavailable({ reason: 'engine', parsedThrough: byteOffset(0n), detail: String(cause) }),
    }),
    (handler) => Effect.sync(() => handler.dispose()),
  );
const binary = (data: string): Uint8Array => {
  const bytes = new Uint8Array(data.length);
  for (let index = 0; index < data.length; index++) bytes[index] = data.charCodeAt(index) & 0xff;
  return bytes;
};
