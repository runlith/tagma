import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import type { TerminalInput } from '@runlith/executions/TerminalInput';
import { WireUnavailable } from '@runlith/executions/Executions';
import {
  BindingId,
  Principal,
  type BindingId as BindingIdType,
  type Principal as PrincipalType,
} from '@runlith/executions/protocol/custody';
import { ExecutionId, InstallationId } from '@runlith/executions/protocol/execution';
import { TargetKey } from '../contract/wire/targets.js';
import type { InteractiveGrant } from '../contract/wire/terminals.js';
import type { GrantClaim } from '../contract/service/grants.js';
import { makeTerminalGrants } from './grantBook.js';

describe('TerminalGrants run keying', () => {
  const installation = InstallationId.make('test-installation');
  const actor = (threadId: string): PrincipalType => Principal.make(`thread:${threadId}`);
  const execution = (id: string) => ({
    installation,
    execution: ExecutionId.make(id),
    incarnation: 1,
  });
  const grant = (threadId: string, id: string, binding: string, runId?: string): InteractiveGrant => ({
    projectId: 1,
    execution: execution(id),
    actor: actor(threadId),
    targetKey: TargetKey.make('target-under-test'),
    binding: BindingId.make(binding),
    permissionRevision: 0,
    runId: runId,
  });
  const claimOf = (live: InteractiveGrant, runId?: string): GrantClaim => ({
    projectId: live.projectId,
    execution: live.execution,
    actor: live.actor,
    binding: live.binding,
    targetKey: live.targetKey,
    permissionRevision: live.permissionRevision,
    runId: runId,
  });

  const executionsOver = (): TerminalInput['Service'] =>
    ({
      closeBinding: (binding: BindingIdType) => Effect.succeed({ _tag: 'Unbound', binding }),
    }) as unknown as TerminalInput['Service'];

  const executionsPending = (): TerminalInput['Service'] =>
    ({
      closeBinding: (_binding: BindingIdType) =>
        Effect.fail(new WireUnavailable({ kind: 'unreachable', reason: 'the host is gone', sent: false })),
    }) as unknown as TerminalInput['Service'];

  it.effect('a grant minted under one run is unspendable under a later run even with settlement skipped', () =>
    Effect.gen(function* () {
      const grants = makeTerminalGrants({ executions: executionsOver() });
      const mine = grant('thread-1', 'exec-1', 'binding-1', 'run-1');
      yield* grants.mint(mine, 'agent');

      expect(yield* Effect.flip(grants.evidence(claimOf(mine, 'run-2')))).toMatchObject({ _tag: 'TerminalRefused', reason: 'no-grant' });
      expect(yield* grants.evidence(claimOf(mine, 'run-1'))).toMatchObject({ binding: mine.binding });
    }),
  );

  it.effect('unkeyed grants keep their shape and never cross the keyed boundary', () =>
    Effect.gen(function* () {
      const grants = makeTerminalGrants({ executions: executionsOver() });
      const plain = grant('thread-1', 'exec-1', 'binding-1');
      const keyed = grant('thread-1', 'exec-2', 'binding-2', 'run-1');
      yield* Effect.all([grants.mint(plain, 'agent'), grants.mint(keyed, 'agent')], { discard: true });

      expect(yield* grants.evidence(claimOf(plain))).toMatchObject({ binding: plain.binding });
      expect(yield* Effect.flip(grants.evidence(claimOf(plain, 'run-1')))).toMatchObject({ _tag: 'TerminalRefused', reason: 'no-grant' });
      expect(yield* Effect.flip(grants.evidence(claimOf(keyed)))).toMatchObject({ _tag: 'TerminalRefused', reason: 'no-grant' });
    }),
  );

  it.effect('a run’s settlement ends its own and unkeyed grants but never another run’s', () =>
    Effect.gen(function* () {
      const grants = makeTerminalGrants({ executions: executionsOver() });
      const ending = grant('thread-1', 'exec-1', 'binding-1', 'run-1');
      const live = grant('thread-1', 'exec-2', 'binding-2', 'run-2');
      const unkeyed = grant('thread-1', 'exec-3', 'binding-3');
      yield* Effect.all([grants.mint(ending, 'agent'), grants.mint(live, 'agent'), grants.mint(unkeyed, 'agent')], { discard: true });

      const outcomes = yield* grants.endRun(actor('thread-1'), 'run-1', 'run-ended');
      expect(outcomes).toHaveLength(2);
      expect(outcomes.every((outcome) => outcome.fence === 'fenced')).toBe(true);

      expect(yield* grants.evidence(claimOf(live, 'run-2'))).toMatchObject({ binding: live.binding });
      expect(yield* Effect.flip(grants.evidence(claimOf(ending, 'run-1')))).toMatchObject({ _tag: 'TerminalRefused', reason: 'no-grant' });
    }),
  );

  it.effect('a run that ended is given no lane again, while a later run of the same thread is', () =>
    Effect.gen(function* () {
      const grants = makeTerminalGrants({ executions: executionsOver() });
      yield* grants.endRun(actor('thread-1'), 'run-1', 'run-ended');

      expect(yield* Effect.flip(grants.mint(grant('thread-1', 'exec-1', 'binding-1', 'run-1'), 'agent'))).toMatchObject({
        _tag: 'TerminalRefused',
        reason: 'stale',
      });
      expect(grants.of(actor('thread-1'))).toEqual([]);
      yield* grants.mint(grant('thread-1', 'exec-1', 'binding-2', 'run-2'), 'agent');
      expect(grants.of(actor('thread-1'))).toHaveLength(1);
    }),
  );

  it.effect('a republished policy refuses a grant minted under the earlier revision', () =>
    Effect.gen(function* () {
      const grants = makeTerminalGrants({ executions: executionsOver() });
      const mine = { ...grant('thread-1', 'exec-1', 'binding-1'), permissionRevision: 0 };
      yield* grants.mint(mine, 'agent');

      expect(yield* grants.evidence({ ...claimOf(mine), permissionRevision: 0 })).toMatchObject({ binding: mine.binding });
      expect(yield* Effect.flip(grants.evidence({ ...claimOf(mine), permissionRevision: 1 }))).toMatchObject({
        _tag: 'TerminalRefused',
        reason: 'stale',
      });
    }),
  );

  it.effect('a replaced custodian ends every grant over the replaced reference', () =>
    Effect.gen(function* () {
      const grants = makeTerminalGrants({ executions: executionsOver() });
      const ref = execution('exec-replaced');
      const minted = grant('thread-1', 'exec-replaced', 'binding-1', 'run-1');
      const standing = grant('thread-1', 'exec-standing', 'binding-2', 'run-1');
      yield* Effect.all([grants.mint(minted, 'agent'), grants.mint(standing, 'agent')], { discard: true });

      yield* grants.endOver(1, ref, 'custodian-replaced');
      expect(grants.over(1, ref)).toEqual([]);
      expect(yield* grants.evidence(claimOf(standing, 'run-1'))).toMatchObject({ binding: standing.binding });
    }),
  );

  it.effect('a pending fence refuses a remint; an acknowledged fence releases it', () =>
    Effect.gen(function* () {
      const shape = {
        projectId: 1,
        actor: actor('thread-1'),
        binding: BindingId.make('binding-f'),
        targetKey: TargetKey.make('target-under-test'),
        permissionRevision: 0,
      } as const;
      const ref = execution('exec-pending');

      const pending = makeTerminalGrants({ executions: executionsPending() });
      yield* pending.mint({ ...shape, execution: ref }, 'agent');
      yield* pending.endOver(1, ref, 'custody-transferred');
      expect(pending.revoking({ ...shape, execution: ref })).toBe('custody-transferred');
      expect(yield* Effect.flip(pending.mint({ ...shape, execution: ref }, 'agent'))).toMatchObject({
        _tag: 'TerminalRefused',
        reason: 'stale',
      });
      expect(yield* Effect.flip(pending.evidence({ ...shape, execution: ref }))).toMatchObject({
        _tag: 'TerminalRefused',
        reason: 'stale',
      });

      const fenced = makeTerminalGrants({ executions: executionsOver() });
      yield* fenced.mint({ ...shape, execution: ref }, 'agent');
      yield* fenced.endOver(1, ref, 'custody-transferred');
      expect(fenced.revoking({ ...shape, execution: ref })).toBeNull();
      expect(yield* fenced.mint({ ...shape, execution: ref }, 'agent')).toMatchObject({ binding: shape.binding });
      expect(yield* fenced.evidence({ ...shape, execution: ref })).toMatchObject({ binding: shape.binding });
    }),
  );

  it.effect('a close lost with the connection is asked again on the next pass, and the fence completes when the host answers', () =>
    Effect.gen(function* () {
      const shape = {
        projectId: 1,
        actor: actor('thread-1'),
        binding: BindingId.make('binding-r'),
        targetKey: TargetKey.make('target-under-test'),
        permissionRevision: 0,
      } as const;
      let reachable = false;
      const asked: string[] = [];
      const grants = makeTerminalGrants({
        executions: {
          closeBinding: (binding: BindingIdType) =>
            Effect.suspend(() => {
              asked.push(binding);
              return reachable
                ? Effect.succeed({ _tag: 'Unbound', binding })
                : Effect.fail(new WireUnavailable({ kind: 'unreachable', reason: 'the host is gone', sent: false }));
            }),
        } as unknown as TerminalInput['Service'],
      });
      const ref = execution('exec-retried');
      yield* grants.mint({ ...shape, execution: ref }, 'agent');
      yield* grants.endOver(1, ref, 'custody-transferred');
      expect(yield* grants.closeOrKeep(BindingId.make('refused-open'), actor('thread-1'))).toBe('pending');
      expect(grants.unclosedCount()).toBe(2);
      expect(yield* grants.retryCloses()).toBe(2);

      reachable = true;
      expect(yield* grants.retryCloses()).toBe(0);
      expect(grants.revoking({ ...shape, execution: ref })).toBeNull();
      expect(asked.filter((binding) => binding === 'refused-open')).toHaveLength(3);
    }),
  );

  it.effect('a lane opened while its binding’s fence is pending is refused, and one on another binding is given', () =>
    Effect.gen(function* () {
      const grants = makeTerminalGrants({ executions: executionsPending() });
      const ref = execution('exec-fenced-lane');
      const target = TargetKey.make('target-under-test');
      const lane = { execution: ref, road: 'agent' } as const;
      const scopeA = { binding: BindingId.make('binding-a'), principal: actor('thread-1'), runId: 'run-1', decisionRevision: 0 };
      const scopeB = { binding: BindingId.make('binding-b'), principal: actor('thread-1'), runId: 'run-1', decisionRevision: 0 };
      yield* grants.settle(1, target, lane, scopeA);

      yield* grants.endOver(1, ref, 'custody-transferred');
      expect(yield* Effect.flip(grants.settle(1, target, lane, scopeA))).toMatchObject({ _tag: 'TerminalRefused', reason: 'stale' });

      yield* grants.settle(1, target, lane, scopeB);
      expect(
        yield* grants.evidence({
          projectId: 1,
          execution: ref,
          actor: actor('thread-1'),
          binding: scopeB.binding,
          targetKey: target,
          permissionRevision: 0,
          runId: 'run-1',
        }),
      ).toMatchObject({ binding: scopeB.binding });
    }),
  );
});
