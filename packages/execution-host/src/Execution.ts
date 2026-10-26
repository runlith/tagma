import { Effect, Semaphore } from 'effect';
import type { CustodyRequest } from '@runlith/executions/protocol/control';
import type { BindingId, CustodyState, Principal } from '@runlith/executions/protocol/custody';
import type { ConnectionId, CustodianEpoch } from '@runlith/executions/protocol/registration';
import type { CallDecision } from '@runlith/executions/protocol/call';
import type { ExecutionRef, ExecutionState, ProcessCost } from '@runlith/executions/protocol/execution';
import type { InputFrontier, InputAnswer, InputRequest } from '@runlith/executions/protocol/input';
import type { ScreenAnswer, ScreenRead } from '@runlith/executions/protocol/presentation';
import type { ExecutionSummary } from '@runlith/executions/protocol/runtime';
import type { ProcessWatchReading } from '@runlith/executions/protocol/stop';
import type { NativeProcess } from '@runlith/executions/protocol/launch';
import { byteOffset, type TerminalGeometry } from '@runlith/executions/protocol/record';
import { Bindings, type BindingRefused, type BindingMissing, type BindingClaim, type LaneRefused, type PrincipalInvalid } from './Bindings';
import { Custodian, type CustodianRefused } from './Custodian';
import type { CustodyLost } from './store/errors';
import type { CustodyAccepted, CustodyMoveFailure } from './ExecutionCustody';
import type { ExecutionCustody } from './ExecutionCustody';
import type { ExecutionInput, InputFenced } from './ExecutionInput';
import type { SegmentRecord } from './ExecutionRecord';
import type { ExecutionStop } from './ExecutionStop';
import { InterpretationMissing, type Interpretation, type InterpretationUnavailable } from './Interpretation';
import type { InputProfileConflict } from './InputModes';
import type { Presentation } from './Presentation';
import type { RecordReaders } from './RecordReaders';

export type AcceptedCustody = CustodyAccepted & { readonly frontier: InputFrontier };

export type CustodyAuthority = {
  readonly principal: Principal;
  readonly connection: ConnectionId;
  readonly epoch: CustodianEpoch;
};

export type AuthorityRefused = CustodianRefused | CustodyLost | BindingMissing | BindingRefused | PrincipalInvalid | LaneRefused;

export type Execution = {
  readonly ref: ExecutionRef;
  readonly custody: ExecutionCustody;
  readonly input: ExecutionInput;
  readonly record: SegmentRecord;
  readonly readers: RecordReaders;
  readonly stop: ExecutionStop;
  readonly interpretation: Interpretation | undefined;
  readonly presentation: Presentation | undefined;
  readonly admitInput: (
    claim: BindingClaim,
    request: InputRequest,
  ) => Effect.Effect<
    InputAnswer,
    AuthorityRefused | InputFenced | InterpretationUnavailable | InterpretationMissing | InputProfileConflict
  >;
  readonly admitCustody: (
    authority: CustodyAuthority,
    request: CustodyRequest,
  ) => Effect.Effect<AcceptedCustody, CustodianRefused | CustodyLost | CustodyMoveFailure>;
  readonly closeBinding: (binding: BindingId, principal: Principal) => Effect.Effect<void>;
  readonly screen: (request?: ScreenRead) => Effect.Effect<ScreenAnswer>;
  readonly summary: (
    state: ExecutionState,
    native: NativeProcess,
    cost: ProcessCost | undefined,
    decision?: CallDecision,
  ) => Effect.Effect<ExecutionSummary>;
  readonly processes: Effect.Effect<ProcessWatchReading | undefined>;
  readonly custodyNow: Effect.Effect<CustodyState>;
};

export type ExecutionParts = {
  readonly ref: ExecutionRef;
  readonly custody: ExecutionCustody;
  readonly input: ExecutionInput;
  readonly record: SegmentRecord;
  readonly readers: RecordReaders;
  readonly stop: ExecutionStop;
  readonly interpretation: Interpretation | undefined;
  readonly presentation: Presentation | undefined;
  readonly geometry: TerminalGeometry;
  readonly watching?: Effect.Effect<ProcessWatchReading>;
};

export const makeExecution = Effect.fnUntraced(function* ({
  ref,
  custody,
  input,
  record,
  readers,
  stop,
  interpretation,
  presentation,
  geometry,
  watching,
}: ExecutionParts) {
  const gate = yield* Semaphore.make(1);
  const bindings = yield* Bindings;
  const custodian = yield* Custodian;
  function admitInput(
    claim: BindingClaim,
    request: InputRequest,
  ): Effect.Effect<InputAnswer, AuthorityRefused | InputFenced | InterpretationUnavailable | InterpretationMissing | InputProfileConflict> {
    return Effect.withSpan(
      gate.withPermits(1)(
        Effect.gen(function* () {
          const binding = yield* bindings.authorize(claim, ref.execution);
          if (request.act._tag === 'Resize') {
            const wanted = request.act.geometry;
            if (wanted.rows > geometry.rows || wanted.columns > geometry.columns) {
              return {
                _tag: 'InputUnsupported',
                act: 'resize',
                reason: 'geometry',
                detail: `a ${wanted.columns}x${wanted.rows} terminal exceeds the reserved ${geometry.columns}x${geometry.rows}`,
              } satisfies InputAnswer;
            }
          }
          if (request.profile !== undefined) {
            if (interpretation === undefined) return yield* new InterpretationMissing();
            yield* interpretation.requireProfile(request.profile);
          }
          return yield* input.admit(request, binding);
        }),
      ),
      'admitInput',
      { attributes: { kind: request.act._tag, bytes: request.act._tag === 'Write' ? request.act.bytes.length : 0 } },
    );
  }

  const admitCustody = Effect.fnUntraced(function* (authority: CustodyAuthority, request: CustodyRequest) {
    yield* custodian.check(authority.epoch, authority.connection);
    return yield* Effect.uninterruptible(
      Effect.gen(function* () {
        const accepted = yield* custody.accept(authority.principal, request.expected, request.act);
        yield* bindings.endLanes(ref.execution);
        yield* input.endLanes();
        const frontier = yield* input.frontier;
        return { ...accepted, frontier } satisfies AcceptedCustody;
      }),
    );
  }, gate.withPermits(1));

  function closeBinding(binding: BindingId, principal: Principal): Effect.Effect<void> {
    return gate.withPermits(1)(input.closeLane(binding, principal));
  }

  function screen(request: ScreenRead = {}): Effect.Effect<ScreenAnswer> {
    return presentation === undefined
      ? Effect.succeed({
          _tag: 'ScreenUnavailable',
          ref: ref,
          parsedThrough: byteOffset(0n),
          reason: 'transport',
          detail: 'this execution runs over pipes and has no terminal to interpret',
        } satisfies ScreenAnswer)
      : presentation.read(request);
  }

  const summary = Effect.fnUntraced(function* (
    state: ExecutionState,
    native: NativeProcess,
    cost: ProcessCost | undefined,
    decision?: CallDecision,
  ) {
    const standingCustody = yield* custody.current;
    const frontier = yield* input.frontier;
    const streams = yield* record.everyPosition;
    const grid = yield* record.grid;
    const processes = watching === undefined ? undefined : yield* watching;
    return {
      state,
      custody: standingCustody,
      streams,
      grid: grid,
      native,
      input: frontier,
      decision: decision,
      cost: cost,
      processes: processes,
      printed: yield* record.printed,
    } satisfies ExecutionSummary;
  });

  return {
    ref: ref,
    custody: custody,
    input: input,
    record: record,
    readers: readers,
    stop: stop,
    interpretation,
    presentation,
    admitInput: admitInput,
    admitCustody: admitCustody,
    closeBinding: closeBinding,
    screen: screen,
    summary: summary,
    processes: watching ?? Effect.succeed(undefined),
    custodyNow: custody.current,
  } satisfies Execution;
});
