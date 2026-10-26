import { Effect } from 'effect';
import type { TerminalInput } from '@runlith/executions/TerminalInput';
import type { BindingId, Principal } from '@runlith/executions/protocol/custody';
import type { ExecutionRef } from '@runlith/executions/protocol/execution';
import { TerminalRefused } from '../contract/wire/refusals.js';
import type { InteractiveGrant } from '../contract/wire/terminals.js';
import { TerminalGrants, type GrantEnded, type GrantEnding, type GrantRevocation, type GrantRoad } from '../contract/service/grants.js';

export const LIVE_INTERACTIVE_GRANTS = 512;

const ENDED_RUNS = 1024;

const identity = (claim: {
  readonly projectId: number;
  readonly execution: ExecutionRef;
  readonly actor: Principal;
  readonly binding: BindingId;
  readonly runId?: string;
}): string =>
  JSON.stringify([
    claim.projectId,
    claim.execution.installation,
    claim.execution.execution,
    claim.execution.incarnation,
    claim.actor,
    claim.binding,
    claim.runId ?? null,
  ]);

const fenceOf = (claim: {
  readonly projectId: number;
  readonly execution: ExecutionRef;
  readonly actor: Principal;
  readonly binding: BindingId;
}): string =>
  JSON.stringify([
    claim.projectId,
    claim.execution.installation,
    claim.execution.execution,
    claim.execution.incarnation,
    claim.actor,
    claim.binding,
  ]);

const runOf = (actor: Principal, runId: string): string => JSON.stringify([actor, runId]);

export const makeTerminalGrants = ({
  executions,
  capacity = LIVE_INTERACTIVE_GRANTS,
}: {
  readonly executions: TerminalInput['Service'];
  readonly capacity?: number;
}) => {
  const live = new Map<string, InteractiveGrant>();
  const roads = new Map<string, GrantRoad>();
  const unfenced = new Map<string, GrantRevocation>();
  const unclosed = new Map<BindingId, { readonly principal: Principal; readonly fences: ReadonlySet<string> }>();
  const watchers = new Set<GrantEnded>();
  const endedRuns = new Set<string>();

  const mint = Effect.fn('TerminalGrants.mint')(function* (grant: InteractiveGrant, road: GrantRoad) {
    const key = identity(grant);
    if (unfenced.has(fenceOf(grant))) {
      return yield* new TerminalRefused({
        reason: 'stale',
        message: 'This lane has a revocation the host has not acknowledged; no right to type is given over it.',
      });
    }
    if (grant.runId !== undefined && endedRuns.has(runOf(grant.actor, grant.runId))) {
      return yield* new TerminalRefused({
        reason: 'stale',
        message: 'The run this lane would type for has ended; nothing types for it any more.',
      });
    }
    if (!live.has(key) && live.size >= capacity) {
      return yield* new TerminalRefused({
        reason: 'capacity',
        message: `This process holds its ceiling of ${capacity} live grants to type; a new one refuses rather than dropping somebody else's.`,
      });
    }
    live.set(key, grant);
    roads.set(key, road);
    return grant;
  });

  const closeOrKeep = Effect.fn('TerminalGrants.closeOrKeep')(function* (binding: BindingId, principal: Principal, fence?: string) {
    const answered = yield* Effect.result(executions.closeBinding(binding, principal));
    const held = unclosed.get(binding);
    const fences = new Set([...(held?.fences ?? []), ...(fence === undefined ? [] : [fence])]);
    if (answered._tag === 'Failure') {
      unclosed.set(binding, { principal, fences });
      yield* Effect.logInfo('the host could not be asked to close a binding; its fence stays pending and the close is retried', {
        binding,
        reason: answered.failure._tag,
      });
      return 'pending' as const;
    }
    if (answered.success._tag === 'Unbound') {
      unclosed.delete(binding);
      for (const ended of fences) unfenced.delete(ended);
      return 'fenced' as const;
    }
    if (answered.success._tag === 'Refused') {
      unclosed.delete(binding);
      yield* Effect.logInfo('the host refused to close a binding; its fence stays pending', {
        binding,
        answer: answered.success._tag,
      });
      return 'pending' as const;
    }
    unclosed.set(binding, { principal, fences });
    return 'pending' as const;
  }, Effect.uninterruptible);

  const revoke = Effect.fn('TerminalGrants.revoke')(function* (
    claim: {
      readonly projectId: number;
      readonly execution: ExecutionRef;
      readonly actor: Principal;
      readonly binding: BindingId;
      readonly runId?: string;
    },
    cause: GrantRevocation,
  ) {
    const key = identity(claim);
    live.delete(key);
    roads.delete(key);
    unfenced.set(fenceOf(claim), cause);
    for (const ended of watchers) ended(claim, cause);
    yield* Effect.annotateCurrentSpan({ cause, binding: claim.binding });
    return yield* closeOrKeep(claim.binding, claim.actor, fenceOf(claim));
  }, Effect.uninterruptible);

  const retryCloses = Effect.fn('TerminalGrants.retryCloses')(function* () {
    for (const [binding, left] of [...unclosed]) yield* closeOrKeep(binding, left.principal);
    return unclosed.size;
  });

  const over = (projectId: number, execution: ExecutionRef): readonly InteractiveGrant[] =>
    [...live.values()].filter(
      (grant) =>
        grant.projectId === projectId &&
        grant.execution.execution === execution.execution &&
        grant.execution.incarnation === execution.incarnation,
    );

  const of = (actor: Principal): readonly InteractiveGrant[] => [...live.values()].filter((grant) => grant.actor === actor);

  const end = Effect.fn('TerminalGrants.end')(function* (ending: readonly InteractiveGrant[], cause: GrantRevocation) {
    const outcomes: GrantEnding[] = [];
    for (const grant of ending) {
      const fence = yield* revoke(
        { projectId: grant.projectId, execution: grant.execution, actor: grant.actor, binding: grant.binding, runId: grant.runId },
        cause,
      );
      outcomes.push({ grant, fence });
    }
    return outcomes;
  });

  return TerminalGrants.of({
    mint,
    watch: (ended) => {
      watchers.add(ended);
      return () => {
        watchers.delete(ended);
      };
    },
    counts: () => {
      const counted = { view: 0, harness: 0, agent: 0 };
      for (const road of roads.values()) counted[road] += 1;
      return counted;
    },
    roadOf: (grant) => roads.get(identity(grant)) ?? null,
    holds: (binding) => [...live.values()].some((grant) => grant.binding === binding),
    evidence: Effect.fn('TerminalGrants.evidence')(function* (claim) {
      const revoking = unfenced.get(fenceOf(claim));
      if (revoking !== undefined) {
        return yield* new TerminalRefused({
          reason: 'stale',
          message: `This lane's right to type was revoked (${revoking}) and the host has not acknowledged its close; nothing more is typed through it.`,
        });
      }
      const held = live.get(identity(claim));
      if (held === undefined) {
        return yield* new TerminalRefused({
          reason: 'no-grant',
          message: 'This writer holds no live right to type into that execution through this lane; nothing was typed.',
        });
      }
      if (held.actor !== claim.actor || held.binding !== claim.binding) {
        return yield* new TerminalRefused({
          reason: 'no-grant',
          message: 'This right to type was given to another writer or another lane; nothing was typed.',
        });
      }
      if ((held.runId ?? null) !== (claim.runId ?? null)) {
        return yield* new TerminalRefused({
          reason: 'stale',
          message: 'This right to type was given under a different run; nothing was typed.',
        });
      }
      if (held.targetKey !== claim.targetKey) {
        return yield* new TerminalRefused({
          reason: 'stale',
          message: 'The target this right to type was approved over is not the target of this call.',
        });
      }
      if (held.permissionRevision !== claim.permissionRevision) {
        return yield* new TerminalRefused({
          reason: 'stale',
          message: 'The permission policy was republished after this right to type was given; current authority must be established again.',
        });
      }
      return held;
    }),
    revoke,
    closeOrKeep,
    retryCloses,
    attendCloses: (everyMs) => Effect.forever(Effect.sleep(everyMs).pipe(Effect.andThen(retryCloses()))),
    unclosedCount: () => unclosed.size,
    settle: Effect.fn('TerminalGrants.settle')(function* (projectId, targetKey, lane, scope) {
      yield* mint(
        {
          projectId,
          execution: lane.execution,
          actor: scope.principal,
          targetKey,
          binding: scope.binding,
          permissionRevision: scope.decisionRevision,
          runId: scope.runId,
        },
        lane.road,
      );
    }),
    over,
    of,
    endOver: (projectId, execution, cause) => end(over(projectId, execution), cause),
    endOf: (actor, cause) => end(of(actor), cause),
    endRun: (actor, runId, cause) =>
      Effect.suspend(() => {
        const ended = runOf(actor, runId);
        endedRuns.delete(ended);
        endedRuns.add(ended);
        if (endedRuns.size > ENDED_RUNS) {
          const oldest = endedRuns.values().next();
          if (oldest.done !== true) endedRuns.delete(oldest.value);
        }
        return end(
          of(actor).filter((grant) => grant.runId === undefined || grant.runId === runId),
          cause,
        );
      }),
    withdrawn: (permissionRevision) =>
      end(
        [...live.values()].filter((grant) => grant.permissionRevision !== permissionRevision),
        'permission-withdrawn',
      ),
    revoking: (claim) => unfenced.get(fenceOf(claim)) ?? null,
  });
};
