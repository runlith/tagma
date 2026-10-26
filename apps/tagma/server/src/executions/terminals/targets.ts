import { Effect } from 'effect';
import { SpawnAnnotation, type CallAnnotation } from '@runlith/executions/executionSpawner';
import type { EnvironmentConsumer } from '../../workspace/contract/wire/environments.js';
import { TerminalRefused, TerminalUnavailable } from '../contract/wire/refusals.js';
import { targetCwd, type ResolvedExecutionTarget } from '../contract/wire/targets.js';
import { TerminalTargets, type ExecutionTargetFailure, type TargetRequest, type TargetScope } from '../contract/service/targets.js';
import { Coverage, FileRoots, type RootScope } from '../../workspace/contract/service/roots.js';
import { Environments, type AcquiredEnvironment } from '../../workspace/contract/service/environments.js';

export const makeTerminalTargets = Effect.gen(function* () {
  const access = yield* Environments;
  const roots = yield* FileRoots;
  const coverage = yield* Coverage;
  const scopes = new WeakMap<CallAnnotation, TargetScope>();

  const resolveIn = Effect.fn('TerminalTargets.scope.resolve')(function* (
    scoped: RootScope,
    request: TargetRequest,
  ): Effect.fn.Return<ResolvedExecutionTarget, ExecutionTargetFailure> {
    const state = yield* access.inspect(request.kind, request.binding === undefined ? {} : { binding: request.binding });
    if (state.binding === null) {
      return yield* new TerminalUnavailable({
        owner: 'environment',
        message: state.reason ?? `The ${request.kind} environment answered for no identity, so no target can be prepared over it.`,
      });
    }
    if (state.binding.namespaceId !== roots.namespaceId) {
      return yield* new TerminalUnavailable({
        owner: 'registry',
        message: `The ${request.kind} environment ${state.binding.environmentId} resolves paths in ${state.binding.namespaceId}; this installation registers roots in ${roots.namespaceId}.`,
      });
    }
    yield* coverage
      .covered(request.projectId)
      .pipe(
        Effect.catchTag('ProjectRootsUnavailable', (refusal) =>
          refusal.reason === 'unestablished' || refusal.reason === 'moved' ? coverage.cover(request.projectId) : Effect.fail(refusal),
        ),
      );
    const footprint = yield* scoped.resolve(request.cwd, request.root);
    return {
      projectId: request.projectId,
      binding: state.binding,
      footprint,
      named: request.root,
    };
  });

  const scope = (): TargetScope => {
    const scoped = roots.scope();
    return { resolve: (request) => resolveIn(scoped, request) };
  };

  const giveBack = Effect.fn('TerminalTargets.giveBack')(function* (acquired: AcquiredEnvironment, consumer: EnvironmentConsumer) {
    if (acquired.use._tag !== 'Retained') return;
    yield* access.releaseUse(acquired.use.use.useId, consumer, 'never-applied').pipe(
      Effect.catch((refusal) =>
        Effect.logWarning('a refused terminal acquisition kept its environment use', {
          useId: acquired.use._tag === 'Retained' ? acquired.use.use.useId : null,
          refusal: refusal._tag,
        }),
      ),
    );
  });

  const admitted = Effect.fn('TerminalTargets.admitted')(
    function* (target: ResolvedExecutionTarget, acquired: AcquiredEnvironment) {
      return yield* coverage.admit({ projectId: target.projectId, footprint: target.footprint, acquired });
    },
    (work, target) =>
      Effect.mapError(work, (failure) =>
        failure._tag === 'RootMissing' ||
        (failure._tag === 'RootConflict' && ['resource-changed', 'registry-changed', 'stale-binding', 'replaced'].includes(failure.reason))
          ? new TerminalRefused({
              reason: 'stale',
              message: `The target moved after it was resolved: ${targetCwd(target)} no longer stands on the registrations this act was approved over.`,
            })
          : failure,
      ),
  );

  return TerminalTargets.of({
    scope,
    resolve: Effect.fn('TerminalTargets.resolve')(function* (request) {
      const call = yield* SpawnAnnotation;
      if (call === undefined) return yield* scope().resolve(request);
      let held = scopes.get(call);
      if (held === undefined) {
        held = scope();
        scopes.set(call, held);
      }
      return yield* held.resolve(request);
    }),
    acquire: Effect.fn('TerminalTargets.acquire')(function* (target, consumer, requires) {
      const acquired = yield* access.acquireActive({ binding: target.binding, consumer, requires });
      const admission = yield* admitted(target, acquired).pipe(Effect.tapError(() => giveBack(acquired, consumer)));
      return { admitted: { target: { ...target, footprint: admission.footprint }, admission }, acquired };
    }),
    readmit: Effect.fn('TerminalTargets.readmit')(function* (held) {
      const admission = yield* admitted(held.admitted.target, held.acquired);
      return { admitted: { target: { ...held.admitted.target, footprint: admission.footprint }, admission }, acquired: held.acquired };
    }),
  });
});
