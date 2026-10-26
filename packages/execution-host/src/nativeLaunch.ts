import { Data, Effect, Schema, Scope } from 'effect';
import type { StopStep } from '@runlith/executions/protocol/call';
import type { NativeRelation } from '@runlith/executions/protocol/capacity';
import type { ExecutionRef } from '@runlith/executions/protocol/execution';
import type { ProcessWitness } from '@runlith/executions/protocol/evidence';
import { Transport, type NativeExit, type ProcessCost } from '@runlith/executions/protocol/execution';
import type { LaunchRequest, NativeProcess, StdinPolicy } from '@runlith/executions/protocol/launch';
import type { Pace } from '@runlith/executions/protocol/pace';
import { Stream as RecordStreamSchema, type SourceStream } from '@runlith/executions/protocol/record';
import type { Capability } from '@runlith/executions/protocol/capability';
import type { EndedAt } from '@runlith/executions/protocol/stop';
import type { LadderAim } from '@runlith/executions/stopLadder';
import type { EndingReason, NativeEnding, StopTarget } from './ExecutionStop';
import { InputWriteFailed, type InputSink } from './ExecutionInput';
import {
  HolderLaunchUncertain,
  type ChannelFailed,
  type HeldExecution,
  type Holder,
  type PendingEcho,
  type Readable,
  type Writable,
} from './holder/Holder';
import { type ProvenSet, proofOf, type Descendant, type ProcessTables, type SetLadder } from './ProvenSet';
import { killStray } from './strayProcesses';
import type { ProcessControl } from './ProcessControl';
import { pipeExecution, retirePipes } from './pipeLaunch';
import { ptyExecution, retirePty } from './ptyLaunch';

export type NativeSource = {
  readonly stream: SourceStream;
  readonly read: (limit: number) => Effect.Effect<Uint8Array | undefined, NativeReadFailed | NativeReadStopped>;
  readonly stop: Effect.Effect<void>;
};

export class NativeReadFailed extends Data.TaggedError('NativeReadFailed')<{
  readonly transport: typeof Transport.Type;
  readonly stream: typeof RecordStreamSchema.Type;
  readonly detail: string;
}> {
  override get message(): string {
    return this.detail ?? this._tag;
  }
}

export class NativeReadStopped extends Data.TaggedError('NativeReadStopped')<{ readonly stream: typeof RecordStreamSchema.Type }> {
  override get message(): string {
    return this._tag;
  }
}

export type NativeExecution = {
  readonly transport: Transport;
  readonly held: HeldExecution;
  readonly identity: NativeProcess;
  readonly witness: ProcessWitness;
  readonly proven: ProvenSet | undefined;
  readonly pace: Pace;

  readonly sink: InputSink;
  readonly target: StopTarget;
  readonly sources: ReadonlyArray<NativeSource>;
  readonly pendingEchoes: Effect.Effect<ReadonlyArray<PendingEcho>>;
  readonly owe: (echoes: ReadonlyArray<PendingEcho>) => Effect.Effect<void>;
  readonly releaseOutput: Effect.Effect<boolean>;
  readonly exit: Effect.Effect<NativeExit, NativeExitUnreadable>;
  readonly cost: Effect.Effect<ProcessCost>;
};

export class NativeExitUnreadable extends Data.TaggedError('NativeExitUnreadable')<{
  readonly transport: typeof Transport.Type;
  readonly ended: boolean;
  readonly detail: string;
}> {
  override get message(): string {
    return this.detail ?? this._tag;
  }
}

export const LEADER: ReadonlyArray<NativeRelation> = ['leader'];
export const LEADER_AND_WORK: ReadonlyArray<NativeRelation> = ['leader', 'work'];
export const LEADER_AND_ANCESTRY: ReadonlyArray<NativeRelation> = ['leader', 'ancestry'];

const LEADER_WORK_AND_ANCESTRY: ReadonlyArray<NativeRelation> = ['leader', 'work', 'ancestry'];

export const pipeCapability = { transport: 'pipes', relations: LEADER_WORK_AND_ANCESTRY } as const;

export class SpawnCapacityExceeded extends Data.TaggedError('SpawnCapacityExceeded')<{
  readonly transport: typeof Transport.Type;
  readonly stage: 'spawn';
  readonly detail: string;
}> {
  override get message(): string {
    return this.detail ?? this._tag;
  }
}

export class NativeSpawnRefused extends Data.TaggedError('NativeSpawnRefused')<{
  readonly transport: typeof Transport.Type;
  readonly stage: 'spawn' | 'readiness';
  readonly detail: string;
}> {
  override get message(): string {
    return this.detail ?? this._tag;
  }
}

export class NativeSpawnUncertain extends Data.TaggedError('NativeSpawnUncertain')<{
  readonly transport: typeof Transport.Type;
  readonly stage: 'spawn';
  readonly detail: string;
}> {
  override get message(): string {
    return this.detail ?? this._tag;
  }
}

export const nativeFailureReason = (failure: unknown): string =>
  failure instanceof NativeSpawnRefused || failure instanceof NativeSpawnUncertain
    ? `${failure.transport}: ${failure.stage}: ${failure.detail}`
    : failure instanceof SpawnCapacityExceeded
      ? failure.detail
      : failure instanceof NativeReadFailed
        ? `${failure.transport}: ${failure.stream}: ${failure.detail}`
        : failure instanceof NativeExitUnreadable
          ? `${failure.transport}: ${failure.detail}`
          : String(failure);

export const stepOf = (endedAt: EndedAt | undefined, steps: ReadonlyArray<StopStep>): EndedAt => endedAt ?? steps.at(-1) ?? 'unsignalled';

export const unmeasured = (pid: number, reason: string, steps: ReadonlyArray<StopStep>): NativeEnding => ({
  exit: undefined,
  measured: [],
  confirmed: [],
  residual: [],
  unverifiable: [{ kind: 'process', detail: `pid ${pid}`, reason }],
  abandonedOutput: false,
  cost: { _tag: 'Unmeasured', reason: 'unknown', detail: 'no wait status was read for this child' },
  steps,
});

export const ladderOver = (proven: ProvenSet | undefined, reason: EndingReason): Effect.Effect<SetLadder | undefined> =>
  proven === undefined
    ? Effect.succeed(undefined)
    : reason === 'stopping'
      ? Effect.as(proven.take(), proven.ladder(killStray(proven.control)))
      : Effect.as(proven.take(), undefined);

export const withAncestry = (ending: NativeEnding, ladder: SetLadder | undefined): Effect.Effect<NativeEnding> =>
  ladder === undefined
    ? Effect.succeed(ending)
    : Effect.map(ladder.left, (swept): NativeEnding => ({
        ...ending,
        measured: [...ending.measured, ...(swept.measured ? ANCESTRY : [])],
        residual: [
          ...ending.residual.map((resource) =>
            resource.relation === 'work' && swept.unproven.length > 0
              ? { ...resource, detail: `${resource.detail}; no round proved ${swept.unproven.join(', ')}` }
              : resource,
          ),
          ...swept.residual,
        ],
        unverifiable: [...ending.unverifiable, ...swept.unverifiable],
      }));

const ANCESTRY: ReadonlyArray<NativeRelation> = ['ancestry'];

export const witnessOf = (held: HeldExecution): ProcessWitness => ({ pid: held.pid, birth: held.birth });

const inputFailure = (failure: ChannelFailed): InputWriteFailed =>
  new InputWriteFailed({
    reason: failure.reason === 'gone' || failure.reason === 'closed' ? 'closed' : failure.reason === 'stopped' ? 'stopped' : 'os',
    detail: failure.detail,
  });

export const writeOnce =
  (channel: Writable) =>
  (bytes: Uint8Array): Effect.Effect<number, InputWriteFailed> =>
    channel.write(bytes).pipe(Effect.mapError(inputFailure));

export const sourceOf = (transport: Transport, stream: SourceStream, channel: Readable): NativeSource => {
  return {
    stream,
    read: (limit) =>
      channel
        .read(limit)
        .pipe(
          Effect.mapError((failure) =>
            failure.reason === 'stopped'
              ? new NativeReadStopped({ stream })
              : new NativeReadFailed({ transport, stream, detail: failure.detail }),
          ),
        ),
    stop: channel.stopReading,
  };
};

const DEPARTURE_POLL_MS = 250;

const departed = (held: HeldExecution, tables: ProcessTables | undefined): Effect.Effect<boolean> =>
  tables === undefined
    ? Effect.succeed(false)
    : Effect.gen(function* () {
        for (;;) {
          const proof = proofOf(tables.reader.identity(held.pid), witnessOf(held));
          if (proof._tag === 'Ended' || proof._tag === 'Left') return true;
          yield* Effect.sleep(DEPARTURE_POLL_MS);
        }
      });

export const exitOf = (
  held: HeldExecution,
  transport: Transport,
  tables: ProcessTables | undefined,
): Effect.Effect<NativeExit, NativeExitUnreadable> =>
  held.exit.pipe(
    Effect.catchTag('HolderRefused', (refused) =>
      refused.reason !== 'lost'
        ? Effect.fail(new NativeExitUnreadable({ transport, ended: false, detail: refused.detail }))
        : Effect.flatMap(departed(held, tables), (gone) =>
            Effect.fail(
              new NativeExitUnreadable({
                transport,
                ended: gone,
                detail: gone
                  ? 'the holder was lost, and the leader left with nobody to read its wait status'
                  : 'the holder was lost, and the leader could not be followed by its birth witness',
              }),
            ),
          ),
    ),
  );

export const leaderSend =
  (held: HeldExecution, tables: ProcessTables | undefined) =>
  (step: StopStep): Effect.Effect<'delivered' | 'reaped' | 'refused'> =>
    held.act('leader', step).pipe(
      Effect.as('delivered' as const),
      Effect.catchTag('HolderRefused', (refused) => {
        if (refused.reason === 'reaped') return Effect.succeed('reaped' as const);
        if (refused.reason !== 'lost' || tables?.control === undefined) return Effect.succeed('refused' as const);
        return Effect.map(tables.control.act(witnessOf(held), step), (sent) =>
          sent === 'delivered' ? ('delivered' as const) : ('refused' as const),
        );
      }),
    );

export const leaderSignal = (held: HeldExecution, tables: ProcessTables | undefined, name: string) =>
  held.signal('leader', name).pipe(
    Effect.as('delivered' as const),
    Effect.catchTag('HolderRefused', (refused) => {
      if (refused.reason === 'unsupported') return Effect.succeed('unsupported' as const);
      if (refused.reason === 'reaped') return Effect.succeed('reaped' as const);
      if (refused.reason !== 'lost' || tables?.control === undefined) return Effect.succeed('refused' as const);
      return Effect.map(tables.control.signal(witnessOf(held), name), (sent) =>
        sent === 'delivered' ? ('delivered' as const) : ('refused' as const),
      );
    }),
  );

export const leaderAim = (held: HeldExecution, tables: ProcessTables | undefined): LadderAim => ({
  send: (signal) => Effect.asVoid(leaderSend(held, tables)(signal)),
  gone: Effect.flatMap(held.observed, (exit) =>
    exit !== undefined
      ? Effect.succeed(true)
      : tables?.control === undefined
        ? Effect.succeed(false)
        : Effect.map(tables.control.standing(witnessOf(held)), (state) => state === 'gone' || state === 'changed'),
  ),
});

export const workAim = (
  held: HeldExecution,
  proven: ProvenSet | undefined,
  control: ProcessControl['Service'] | undefined = proven?.control,
): LadderAim => {
  const witnesses = Effect.gen(function* () {
    const members = proven === undefined ? [] : yield* proven.inWork(held.work);
    return [witnessOf(held), ...members];
  });
  return {
    send: (step) =>
      Effect.flatMap(Effect.result(held.act('work', step)), (sent) =>
        sent._tag === 'Failure' && (sent.failure.reason === 'lost' || sent.failure.reason === 'reaped')
          ? Effect.flatMap(witnesses, (known) => Effect.asVoid(Effect.forEach(known, (witness) => killStray(control)(witness, step))))
          : Effect.void,
      ),
    gone: Effect.flatMap(held.workState, (state) =>
      state !== 'unmeasured'
        ? Effect.succeed(state === 'ended')
        : control === undefined
          ? Effect.succeed(false)
          : Effect.flatMap(witnesses, (known) =>
              Effect.map(
                Effect.forEach(known, (witness) => control.standing(witness)),
                (states) => states.every((state) => state === 'gone' || state === 'changed'),
              ),
            ),
    ),
  };
};

export const reapedCost = (held: HeldExecution): Effect.Effect<ProcessCost> =>
  held.reap.pipe(
    Effect.map((reaped) => reaped.cost),
    Effect.catchTag('HolderRefused', (refused) =>
      Effect.succeed<ProcessCost>({
        _tag: 'Unmeasured',
        reason: refused.reason === 'running' ? 'unknown' : 'failed',
        detail: refused.detail,
      }),
    ),
  );

export const launchNative = Effect.fnUntraced(function* (
  launch: LaunchRequest,
  ref: ExecutionRef,
  holder: Holder['Service'],
  strays?: ProcessTables,
  pace: Pace = 'full',
): Effect.fn.Return<NativeExecution, NativeSpawnRefused | NativeSpawnUncertain | SpawnCapacityExceeded, Scope.Scope> {
  const transport = launch.transport._tag;
  const environment = launch.command.environment;
  const held = yield* Effect.acquireRelease(
    holder
      .launch({
        id: ref.execution,
        path: launch.command.program,
        argv: [launch.command.program, ...launch.command.args],
        env: environment.map((entry) => ({ name: entry.name, value: entry.value })),
        cwd: launch.command.cwd,
        transport: launch.transport,
        pace,
      })
      .pipe(
        Effect.mapError((refused) =>
          refused instanceof HolderLaunchUncertain
            ? new NativeSpawnUncertain({ transport, stage: 'spawn', detail: refused.detail })
            : refused.reason === 'capacity'
              ? new SpawnCapacityExceeded({ transport, stage: 'spawn', detail: refused.detail })
              : new NativeSpawnRefused({ transport, stage: 'spawn', detail: refused.detail }),
        ),
      ),
    (launched) => (launched.channels._tag === 'pty' ? retirePty(launched, strays) : retirePipes(launched, strays, holder.capabilities)),
  );
  return yield* executionOf(held, launch.transport._tag === 'pipes' ? launch.transport.stdin : 'ignore', strays, holder.capabilities);
});

const executionOf = (
  held: HeldExecution,
  stdin: StdinPolicy,
  strays: ProcessTables | undefined,
  capabilities: ReadonlySet<Capability>,
  remembered: ReadonlyArray<Descendant> = [],
): Effect.Effect<NativeExecution, never, Scope.Scope> =>
  held.channels._tag === 'pty' ? ptyExecution(held, strays, remembered) : pipeExecution(held, stdin, strays, capabilities, remembered);

export const adoptNative = (
  held: HeldExecution,
  holder: Holder['Service'],
  strays?: ProcessTables,
  remembered: ReadonlyArray<Descendant> = [],
  retiring: Effect.Effect<boolean> = Effect.succeed(true),
): Effect.Effect<NativeExecution, never, Scope.Scope> =>
  Effect.acquireRelease(Effect.succeed(held), (adopted) =>
    Effect.flatMap(retiring, (retire) =>
      !retire
        ? Effect.void
        : adopted.channels._tag === 'pty'
          ? retirePty(adopted, strays)
          : retirePipes(adopted, strays, holder.capabilities),
    ),
  ).pipe(
    Effect.flatMap((adopted) =>
      executionOf(
        adopted,
        adopted.channels._tag === 'pipes' && adopted.channels.stdin !== undefined ? 'pipe' : 'ignore',
        strays,
        holder.capabilities,
        remembered,
      ),
    ),
  );
