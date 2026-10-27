import { Context, Deferred, Effect, type Scope } from 'effect';
import { type TerminalLane } from '@runlith/executions/protocol/lane';
import { type AuthorityRefused, type CustodyAuthority } from '../Execution';
import { type LaneWatch } from '../LaneInputs';
import { type LaneUnserved } from '../TerminalInputs';
import { type BindingClaim } from '../Bindings';
import { type BindingId, type Principal } from '@runlith/executions/protocol/custody';
import { type CustodianRefused } from '../Custodian';
import { type CustodyAnswer, type CustodyRequest } from '@runlith/executions/protocol/control';
import { type CustodyLost } from '../store/errors';
import { ExecutionId } from '@runlith/executions/protocol/execution';
import { ExecutionUnknown } from '../executionFailures';
import { type HostClaim, type RegistryState, commanding, inventoryMoved, live, moved } from './state';
import { type InputAnswer, type InputRequest } from '@runlith/executions/protocol/input';
import { type InputFenced } from '../ExecutionInput';
import type { InterpretationMissing, InterpretationUnavailable } from '../Interpretation';
import type { InputProfileConflict } from '../InputModes';
import { type Pace, type PaceReport } from '@runlith/executions/protocol/pace';
import { custodySentence } from '../ExecutionCustody';

export class InputLanes extends Context.Service<
  InputLanes,
  {
    readonly admit: (
      execution: ExecutionId,
      claim: BindingClaim,
      request: InputRequest,
    ) => Effect.Effect<
      InputAnswer,
      ExecutionUnknown | AuthorityRefused | InputFenced | InterpretationUnavailable | InterpretationMissing | InputProfileConflict
    >;
    readonly close: (binding: BindingId, principal: Principal) => Effect.Effect<void>;
    readonly open: (
      execution: ExecutionId,
      claim: BindingClaim,
    ) => Effect.Effect<TerminalLane, ExecutionUnknown | AuthorityRefused | LaneUnserved>;
    readonly inputs: (execution: ExecutionId) => Effect.Effect<LaneFollow, ExecutionUnknown, Scope.Scope>;
  }
>()('@runlith/execution-host/InputLanes') {}

export type LaneFollow = LaneWatch & { readonly over: Effect.Effect<void> };

export class CustodyControl extends Context.Service<
  CustodyControl,
  {
    readonly move: (authority: CustodyAuthority, request: CustodyRequest) => Effect.Effect<CustodyAnswer, ExecutionUnknown>;
  }
>()('@runlith/execution-host/CustodyControl') {}

export class PaceControl extends Context.Service<
  PaceControl,
  {
    readonly set: (claim: HostClaim, pace: Pace) => Effect.Effect<PaceReport, CustodianRefused | CustodyLost>;
  }
>()('@runlith/execution-host/PaceControl') {}

export const inputLanesOf = (registry: RegistryState) => {
  const { bindings, held } = registry;
  return InputLanes.of({
    admit: (execution, claim, request) =>
      Effect.flatMap(live(registry, execution), (found) =>
        Effect.tap(found.execution.admitInput(claim, request), () => moved(registry, found)),
      ),
    close: (binding, principal) =>
      Effect.flatMap(bindings.close(binding, principal), (execution) =>
        Effect.suspend(() => {
          const found = execution === undefined ? undefined : held.get(execution);
          return found === undefined ? Effect.void : found.execution.closeBinding(binding, principal);
        }),
      ),
    open: (execution, claim) => Effect.flatMap(live(registry, execution), (found) => found.execution.openLane(claim)),
    inputs: (execution) =>
      Effect.flatMap(live(registry, execution), (found) =>
        Effect.map(found.execution.inputs, (watch) => ({ next: watch.next, over: Deferred.await(found.worked) })),
      ),
  });
};

export const custodyControlOf = (registry: RegistryState) =>
  CustodyControl.of({
    move: (authority, request) =>
      Effect.flatMap(live(registry, request.execution.execution), (found) =>
        Effect.gen(function* () {
          const accepted = yield* Effect.result(found.execution.admitCustody(authority, request));
          if (accepted._tag === 'Success') {
            return {
              _tag: 'Accepted',
              receipt: {
                operation: request.operation,
                execution: found.ref,
                custody: accepted.success.custody,
                frontier: accepted.success.frontier,
              },
            } satisfies CustodyAnswer;
          }
          if (accepted.failure._tag === 'RevisionConflict') {
            const custody = yield* found.execution.custody.current;
            return { _tag: 'RevisionStale', execution: found.ref, expected: request.expected, custody } satisfies CustodyAnswer;
          }
          return {
            _tag: 'Refused',
            operation: request.operation,
            refusal: {
              _tag: 'CustodyConflict',
              reason:
                accepted.failure._tag === 'NotHolder'
                  ? custodySentence(accepted.failure)
                  : `this host refused the custody act: ${accepted.failure._tag}`,
            },
          } satisfies CustodyAnswer;
        }),
      ),
  });

export const paceControlOf = (registry: RegistryState) => {
  const { pacing } = registry;
  return PaceControl.of({
    set: Effect.fn('PaceControl.set')(function* (claim, pace) {
      yield* commanding(registry, claim, 'start');
      const standing = pacing.standing !== pace;
      const changed = yield* pacing.change(pace);
      for (const execution of changed.moved) yield* inventoryMoved(registry, execution);
      if (changed.report._tag === 'Applied' && standing && changed.moved.length === 0) yield* inventoryMoved(registry);
      return changed.report;
    }),
  });
};
