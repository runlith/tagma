import { SessionIdentity } from '../../platform/contract/wire/session.js';

import { Effect } from 'effect';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import { MachineUnits, type Unit } from '../../platform/contract/service/units.js';
import type { Commands } from '@runlith/executions/Commands';
import { ThreadLineage } from '../../workspace/contract/service/assignments.js';
import { TerminalRefused, TerminalUnavailable } from '../contract/wire/refusals.js';
import { principalOf } from '../terminals/principals.js';
import { type TerminalActor } from '../contract/wire/terminals.js';
import { principalOfSubject, type CommandRelation, type CommandSubject } from '../contract/wire/commandSubject.js';
import type { CommandRecord } from '../contract/wire/commands.js';
import { CommandAccess, type CommandPreparation, type ResolvedRequest, type RuledPlace } from '../contract/service/access.js';
import { CheckoutPaths } from '../../workspace/contract/service/checkoutPaths.js';
import { programRootOf, resolveCommandPolicy } from './policy.js';
import type { CommandRule } from '../contract/wire/commandRules.js';
import { commandEligibility, reviseDirection, type CommandOperation } from './eligibility.js';
import { commandSubjects, type CommandSubjectRequest } from './subjects.js';
import { encode, targetIdentity, targetKeyOf } from '../terminals/subjectPolicy.js';
import type { TerminalThreads } from '../terminals/threads.js';
import type { CommandRows } from '../store/commandRows.js';
import { viewOf } from './reader.js';

type Managed = Exclude<ResolvedRequest, { readonly _tag: 'Launch' }>;

const launchThread = (request: { readonly _tag: string; readonly actor: TerminalActor }): string | null =>
  request._tag === 'Launch' && request.actor._tag === 'Thread' ? request.actor.threadId : null;

const readable = <A>(work: Effect.Effect<A, StoreFailure>): Effect.Effect<A, TerminalUnavailable> =>
  Effect.mapError(
    work,
    (cause) => new TerminalUnavailable({ owner: 'store', message: `The thread register could not answer: ${cause.message}` }),
  );

const commandAct = (request: Managed): Exclude<CommandOperation, { readonly _tag: 'Launch' }> => {
  switch (request._tag) {
    case 'Observe':
      return { _tag: 'Observe', execution: request.execution };
    case 'Await':
      return { _tag: 'Await', execution: request.execution };
    case 'Stop':
      return { _tag: 'Stop', execution: request.execution };
    case 'Revise':
      return {
        _tag: 'Revise',
        execution: request.execution,
        current: {
          executionMs: request.current.executionMs,
          ceilingMs: request.current.ceilingMs,
        },
        change: request.change,
        exception: request.exceptionMs !== undefined,
      };
  }
};

const subjectRequest = (request: Managed): Exclude<CommandSubjectRequest, { readonly _tag: 'Launch' }> => {
  switch (request._tag) {
    case 'Observe':
      return { _tag: 'Observe', execution: request.execution };
    case 'Await':
      return { _tag: 'Await', execution: request.execution };
    case 'Stop':
      return { _tag: 'Stop', execution: request.execution };
    case 'Revise': {
      const direction = reviseDirection(request.current, request.change);
      return {
        _tag: 'Revise',
        execution: request.execution,
        expected: request.current.revision,
        direction,
        changeMs: request.change._tag === 'Total' ? request.change.executionMs : request.change.remainingMs,
        exceptionCeilingMs: request.exceptionMs,
      };
    }
  }
};

export const makeCommandAccess = Effect.fnUntraced(function* ({
  commandRows,
  register,
  executions,
  rules,
}: {
  readonly commandRows: CommandRows;
  readonly register: TerminalThreads;
  readonly executions: Commands['Service'];
  readonly rules: (projectId: number, thread: string, home: number) => Effect.Effect<readonly CommandRule[], StoreFailure>;
}) {
  const threads = yield* ThreadLineage;
  const units = yield* MachineUnits;
  const paths = yield* CheckoutPaths;
  const identity = yield* SessionIdentity;

  const policy = (unit: Unit<'machine'>, scope: number, ruled: RuledPlace | null, thread: string | null) =>
    Effect.map(thread === null ? Effect.succeed([]) : readable(unit.run(rules(ruled?.projectId ?? scope, thread, scope))), (found) => ({
      rules: found,
    }));

  const ruledAt = (cwd: string | undefined): Effect.Effect<RuledPlace | null, TerminalUnavailable> =>
    cwd === undefined
      ? Effect.succeed(null)
      : paths.resourceAcross(cwd).pipe(
          Effect.map((place) =>
            place === null
              ? null
              : { projectId: place.projectId, root: place.root, cwd: place.path === '' ? place.root : `${place.root}/${place.path}` },
          ),
          Effect.mapError(
            (failure) =>
              new TerminalUnavailable({ owner: 'registry', message: `The checkout of ${cwd} could not be read: ${failure.reason}` }),
          ),
        );

  const relationOf = Effect.fn('CommandAccess.relationOf')(function* (
    unit: Unit<'machine'>,
    actor: TerminalActor,
    origin: CommandRecord,
  ): Effect.fn.Return<{ readonly relation: CommandRelation; readonly lineage: CommandPreparation['lineage'] }, TerminalUnavailable> {
    if (actor._tag === 'Operator') return { relation: 'operator', lineage: null };
    if (actor._tag === 'Foreign') return { relation: 'ungated', lineage: null };
    if (origin.owner._tag === 'Thread' && origin.owner.thread === actor.threadId) return { relation: 'own', lineage: null };
    if (origin.owner._tag !== 'Thread') return { relation: 'other', lineage: null };
    const descends = yield* readable(threads.isDescendant(origin.owner.thread, actor.threadId, unit));
    const standing = yield* register.read(actor.threadId);
    const live = standing === null ? false : standing.live;
    const sameProject = standing !== null && standing.projectId === origin.projectId;
    const ancestor = descends && live && sameProject;
    return {
      relation: ancestor ? 'ancestor' : 'other',
      lineage: { actorThread: actor.threadId, descends, live },
    };
  });

  const prepareLaunch = Effect.fn('CommandAccess.prepareLaunch')(function* (
    unit: Unit<'machine'>,
    request: Extract<ResolvedRequest, { readonly _tag: 'Launch' }>,
    actorKnown: boolean,
  ): Effect.fn.Return<CommandPreparation, TerminalRefused | TerminalUnavailable> {
    if (request.target.projectId !== request.scope) {
      return yield* new TerminalRefused({ reason: 'foreign-project', message: 'The resolved target belongs to another project.' });
    }
    if (request.actor._tag === 'Thread' && (request.creator._tag !== 'Thread' || request.creator.thread !== request.actor.threadId)) {
      return yield* new TerminalRefused({
        reason: 'ineligible',
        message: 'A launch attributes its creator thread; it cannot be born as another thread or the operator.',
      });
    }
    if (request.actor._tag === 'Operator' && request.creator._tag === 'Thread') {
      const created = yield* register.read(request.creator.thread);
      if (created === null) {
        return yield* new TerminalRefused({ reason: 'no-owner', message: 'This installation holds no thread under the named creator.' });
      }
      if (created.projectId !== request.scope) {
        return yield* new TerminalRefused({
          reason: 'foreign-project',
          message: `The named creator works project ${created.projectId}; this call addresses project ${request.scope}.`,
        });
      }
    }
    if (request.owner._tag === 'Service' && request.actor._tag === 'Thread') {
      return yield* new TerminalRefused({
        reason: 'service-denied',
        message: 'Service-owned work runs under its own authority, and this act carries none.',
      });
    }
    const relation = launchRelation(request.actor, request.owner);
    const standing = request.owner._tag === 'Thread' ? yield* register.read(request.owner.thread) : undefined;
    const verdict = commandEligibility({
      actor: request.actor,
      actorKnown,
      scope: request.scope,
      relation,
      namedOwner: standing === undefined ? undefined : standing === null ? null : { projectId: standing.projectId, live: standing.live },
      act: { _tag: 'Launch', owner: request.owner },
      identity,
    });
    if (verdict._tag === 'Refused') return yield* verdict.refusal;
    const receipt = resolveCommandPolicy(request.policy, {
      thread: launchThread(request),
      tool: request.tool,
      requested: request.requested,
      waitMs: request.waitMs,
      root: request.ruled?.root ?? programRootOf(request.target),
    });
    const fence = yield* commandRows.ownerFence(unit, request.scope, request.owner);
    const targetKey = targetKeyOf(targetIdentity(request.target, principalOfSubject(request.owner), principalOf(request.actor)));
    const prepared = commandSubjects({ _tag: 'Resolved', target: request.target }, targetKey, {
      _tag: 'Launch',
      operation: request.operation,
      program: request.program,
      args: request.args,
      owner: request.owner,
    });
    return {
      request,
      subjects: prepared.subjects,
      facts: prepared.facts,
      targetKey,
      receipt,
      origin: null,
      owner: request.owner,
      ownerStanding: standing === undefined || standing === null ? null : { projectId: standing.projectId, live: standing.live },
      ownerFence: fence,
      lineage: null,
      relation,
      policyIdentity: receipt.policyIdentity,
    };
  });

  const prepareManaged = Effect.fn('CommandAccess.prepareManaged')(function* (
    unit: Unit<'machine'>,
    request: Managed,
    actorKnown: boolean,
  ): Effect.fn.Return<CommandPreparation, TerminalRefused | TerminalUnavailable> {
    const origin = yield* commandRows.recordCommand(unit, request.execution.execution);
    if (origin === null) {
      return yield* new TerminalRefused({
        reason: 'no-command',
        message: `This installation holds no command under ${request.execution.execution}; read the inventory again.`,
      });
    }
    if (
      origin.execution.installation !== request.execution.installation ||
      origin.execution.incarnation !== request.execution.incarnation
    ) {
      return yield* new TerminalRefused({
        reason: 'stale-authority',
        message: 'The requested execution reference does not match the stored command.',
      });
    }
    const relation = yield* relationOf(unit, request.actor, origin);
    const verdict = commandEligibility({
      actor: request.actor,
      actorKnown,
      scope: request.scope,
      relation: relation.relation,
      origin,
      act: commandAct(request),
      identity,
    });
    if (verdict._tag === 'Refused') return yield* verdict.refusal;
    const targetKey = origin.targetKey;
    const prepared = commandSubjects({ _tag: 'Keyed', projectId: origin.projectId, targetKey }, targetKey, subjectRequest(request));
    return {
      request,
      subjects: prepared.subjects,
      targetKey,
      origin: viewOf(origin),
      owner: null,
      ownerStanding: null,
      ownerFence: null,
      lineage: relation.lineage,
      relation: relation.relation,
      policyIdentity: null,
      revision: request._tag === 'Revise' ? request.current.revision : undefined,
    };
  });

  const resolve = Effect.fn('CommandAccess.resolve')(function* (unit: Unit<'machine'>, request: ResolvedRequest) {
    const actorProject =
      request.actor._tag === 'Thread'
        ? yield* readable(threads.projectOf(request.actor.threadId, unit))
        : request.actor._tag === 'Foreign'
          ? request.actor.projectId
          : undefined;
    const actorKnown = request.actor._tag !== 'Thread' || actorProject !== undefined;
    const prepared =
      request._tag === 'Launch' ? yield* prepareLaunch(unit, request, actorKnown) : yield* prepareManaged(unit, request, actorKnown);
    return {
      ...prepared,
      subjects: prepared.subjects.map((subject) => ({
        ...subject,
        binding: encode([
          subject.binding,
          principalOf(request.actor),
          actorProject ?? null,
          prepared.origin,
          prepared.owner,
          prepared.ownerStanding,
          prepared.lineage,
          prepared.receipt?.policyIdentity ?? null,
        ]),
      })),
    };
  });

  return CommandAccess.of({
    prepare: Effect.fn('CommandAccess.prepare')(function* (request) {
      const snapshot = request._tag === 'Revise' ? yield* executions.command(request.execution) : undefined;
      if (request._tag === 'Revise' && snapshot === undefined) {
        return yield* new TerminalRefused({ reason: 'no-command', message: 'The host holds no bounded command under this reference.' });
      }
      const physical = request._tag === 'Launch' ? yield* ruledAt(request.cwd) : null;
      const ruled =
        request._tag === 'Launch' && request.policyRoot !== undefined && request.policyRoot !== request.cwd
          ? yield* ruledAt(request.policyRoot)
          : physical;
      if (request._tag === 'Launch' && request.policyRoot !== undefined && ruled === null) {
        return yield* new TerminalUnavailable({
          owner: 'registry',
          message: `The policy checkout ${request.policyRoot} is not registered.`,
        });
      }
      return yield* units.read((unit) =>
        Effect.gen(function* () {
          let resolved: ResolvedRequest;
          if (request._tag === 'Launch')
            resolved = {
              ...request,
              cwd: physical?.cwd ?? request.cwd,
              ruled: ruled === null ? null : { ...ruled, cwd: physical?.cwd ?? request.cwd ?? ruled.cwd },
              policy: yield* policy(unit, request.scope, ruled, launchThread(request)),
            };
          else if (request._tag === 'Revise' && snapshot !== undefined) resolved = { ...request, current: snapshot.deadline };
          else if (request._tag === 'Revise')
            return yield* new TerminalRefused({ reason: 'no-command', message: 'No command deadline was read.' });
          else resolved = request;
          const prepared = yield* resolve(unit, resolved);
          return { ...prepared, request: resolved, policyIdentity: prepared.receipt?.policyIdentity ?? null };
        }),
      );
    }),
    recheck: Effect.fn('CommandAccess.recheck')(function* (unit, prepared) {
      const request =
        prepared.request._tag === 'Launch'
          ? {
              ...prepared.request,
              policy: yield* policy(unit, prepared.request.scope, prepared.request.ruled, launchThread(prepared.request)),
            }
          : prepared.request;
      const checked = yield* Effect.result(resolve(unit, request));
      if (checked._tag === 'Failure') {
        if (checked.failure._tag === 'TerminalUnavailable') return yield* checked.failure;
        return yield* stale(checked.failure.message);
      }
      const fresh = checked.success;
      const freshIdentity = { ...fresh, policyIdentity: fresh.receipt?.policyIdentity ?? null };
      if (!sameExcept(freshIdentity, prepared, ['request', 'facts', 'receipt', 'revision', 'ownerFence'])) {
        return yield* stale('The authority or policy bound at preparation changed before admission.');
      }
      if (fresh.ownerFence !== prepared.ownerFence) {
        return yield* stale('The owner was fenced against new commands after this launch was prepared.');
      }
    }),
  });
});

function launchRelation(actor: TerminalActor, owner: CommandSubject): CommandRelation {
  if (actor._tag === 'Operator') return 'operator';
  if (actor._tag === 'Foreign') return 'ungated';
  return owner._tag === 'Thread' && owner.thread === actor.threadId ? 'own' : 'other';
}

const stale = (message: string): TerminalRefused => new TerminalRefused({ reason: 'stale-authority', message });

const sameValue = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true;
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const l = left as Record<string, unknown>;
  const r = right as Record<string, unknown>;
  const keys = new Set([...Object.keys(l), ...Object.keys(r)]);
  for (const key of keys) {
    if (!Object.hasOwn(l, key) || !Object.hasOwn(r, key) || !sameValue(l[key], r[key])) return false;
  }
  return true;
};

const sameExcept = (left: object, right: object, skip: readonly string[]): boolean => {
  const l = left as Record<string, unknown>;
  const r = right as Record<string, unknown>;
  const keys = new Set([...Object.keys(l), ...Object.keys(r)]);
  for (const key of keys) {
    if (skip.includes(key)) continue;
    if (!Object.hasOwn(l, key) || !Object.hasOwn(r, key) || !sameValue(l[key], r[key])) return false;
  }
  return true;
};
