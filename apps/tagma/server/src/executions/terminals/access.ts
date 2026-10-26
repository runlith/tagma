import { Effect } from 'effect';
import type { Principal } from '@runlith/executions/protocol/custody';
import { ThreadId } from '../../platform/contract/wire/thread.js';
import type { Actor } from '../../platform/contract/wire/actor.js';
import { spokenId } from '../../platform/contract/wire/ids.js';
import { NATIVE_HARNESS } from '../../platform/contract/wire/session.js';
import { TerminalRefused, type TerminalUnavailable } from '../contract/wire/refusals.js';
import { type TerminalActor, type InteractiveGrant } from '../contract/wire/terminals.js';
import { principalOf } from './principals.js';
import type { TargetKey } from '../contract/wire/targets.js';
import { TerminalAccess, type TerminalActRequest } from '../contract/service/access.js';
import type { TerminalGrants } from '../contract/service/grants.js';
import { terminalPolicy, type TerminalOperation, type TerminalInstruction } from './policy.js';
import { placeProject, targetIdentity, targetKeyOf, terminalSubjects } from './subjectPolicy.js';
import type { TerminalThreads } from './threads.js';

export const makeTerminalAccess = ({
  grants,
  threads,
}: {
  readonly grants: TerminalGrants['Service'];
  readonly threads: TerminalThreads;
}) => {
  const resolved = Effect.fn('TerminalAccess.resolved')(function* (
    act: TerminalInstruction,
  ): Effect.fn.Return<TerminalOperation, TerminalRefused | TerminalUnavailable> {
    if (act._tag !== 'Transfer') return act;
    if (act.to._tag === 'Operator') return { _tag: 'Transfer', to: act.to };
    const thread = yield* threads.read(act.to.threadId);
    if (thread === null) {
      return yield* new TerminalRefused({
        reason: 'destination',
        message: `This installation holds no thread ${act.to.threadId}; custody cannot land on a thread that does not exist.`,
      });
    }
    return {
      _tag: 'Transfer',
      to: { _tag: 'Thread', threadId: act.to.threadId, projectId: thread.projectId, live: thread.live },
    };
  });

  const held = Effect.fn('TerminalAccess.held')(function* (
    request: TerminalActRequest,
    targetKey: TargetKey,
    actor: Principal,
  ): Effect.fn.Return<InteractiveGrant | null, TerminalRefused> {
    if (request.act._tag !== 'Input') return null;
    const live = request.interactive;
    if (live === undefined) return null;
    return yield* grants.evidence({
      projectId: placeProject(request.place),
      execution: live.execution,
      actor,
      binding: live.binding,
      targetKey,
      permissionRevision: live.permissionRevision,
      runId: live.runId,
    });
  });

  return TerminalAccess.of({
    prepare: Effect.fn('TerminalAccess.prepare')(function* (request) {
      const verdict = terminalPolicy({ actor: request.actor, standing: request.standing, act: yield* resolved(request.act) });
      if (verdict._tag === 'Refused') return yield* verdict.refusal;
      const actor = principalOf(request.actor);
      const targetKey =
        request.place._tag === 'Keyed'
          ? request.place.targetKey
          : (request.place.targetKey ?? targetKeyOf(targetIdentity(request.place.target, request.owner, actor)));
      const prepared = terminalSubjects(request.place, targetKey, request.subject);
      const grant = yield* held(request, targetKey, actor);
      return {
        ...prepared,
        grant: grant ?? undefined,
      };
    }),
  });
};
