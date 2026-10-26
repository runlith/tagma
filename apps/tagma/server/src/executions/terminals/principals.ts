import { Effect } from 'effect';
import { Principal } from '@runlith/executions/protocol/custody';
import type { Actor, ActorRef } from '../../platform/contract/wire/actor.js';
import { spokenId } from '../../platform/contract/wire/ids.js';
import { NATIVE_HARNESS } from '../../platform/contract/wire/session.js';
import { ThreadId } from '../../platform/contract/wire/thread.js';
import { TerminalRefused } from '../contract/wire/refusals.js';
import type { TerminalActor } from '../contract/wire/terminals.js';

export const actorRefOfTerminal = (actor: TerminalActor): ActorRef =>
  actor._tag === 'Operator'
    ? { kind: 'operator' }
    : actor._tag === 'Thread'
      ? { kind: 'thread', threadId: actor.threadId, projectId: actor.projectId }
      : { kind: 'session', session: { harness: actor.harness, key: actor.key }, projectId: actor.projectId };

export const executionActorOf = (actor: Actor, projectId: number): TerminalActor | TerminalRefused => {
  if (actor.kind === 'operator') return { _tag: 'Operator' };
  if (actor.kind === 'thread') return { _tag: 'Thread', threadId: ThreadId.make(actor.threadId), projectId };
  if (actor.kind === 'external') {
    return new TerminalRefused({
      reason: 'ineligible',
      message: `External caller ${actor.name} holds no managed executions: they belong to the operator, a thread or a foreign session.`,
    });
  }
  if (actor.session.harness === NATIVE_HARNESS) {
    return new TerminalRefused({
      reason: 'ineligible',
      message: `Session ${spokenId(actor.session.key)} is a thread of this server standing in no project of its own, so there is no project to act on a managed execution in.`,
    });
  }
  return { _tag: 'Foreign', harness: actor.session.harness, key: actor.session.key, projectId };
};

export const custodianOf = (actor: Actor, projectId: number): TerminalActor | TerminalRefused =>
  executionActorOf(actor, actor.kind === 'thread' ? actor.projectId : projectId);

export const actorOf = (actor: Actor, projectId: number): Effect.Effect<TerminalActor, TerminalRefused> => {
  const answered = executionActorOf(actor, projectId);
  return answered instanceof TerminalRefused ? Effect.fail(answered) : Effect.succeed(answered);
};

export const terminalActorOfRef = (ref: ActorRef): TerminalActor =>
  ref.kind === 'operator'
    ? { _tag: 'Operator' }
    : ref.kind === 'thread'
      ? { _tag: 'Thread', threadId: ThreadId.make(ref.threadId), projectId: ref.projectId }
      : { _tag: 'Foreign', harness: ref.session.harness, key: ref.session.key, projectId: ref.projectId };

const THREAD_PRINCIPAL = 'thread:';

const FOREIGN_PRINCIPAL = 'foreign:';

const OPERATOR_PRINCIPAL = 'operator';

export const principalOf = (actor: TerminalActor): Principal =>
  Principal.make(
    actor._tag === 'Operator'
      ? OPERATOR_PRINCIPAL
      : actor._tag === 'Thread'
        ? `${THREAD_PRINCIPAL}${actor.threadId}`
        : `${FOREIGN_PRINCIPAL}${actor.harness}:${actor.key}`,
  );

export const actorOfPrincipal = (principal: Principal, projectId: number): TerminalActor | null => {
  if (principal === OPERATOR_PRINCIPAL) return { _tag: 'Operator' };
  if (principal.startsWith(THREAD_PRINCIPAL)) {
    const threadId = principal.slice(THREAD_PRINCIPAL.length);
    return threadId.length === 0 ? null : { _tag: 'Thread', threadId: ThreadId.make(threadId), projectId };
  }
  if (principal.startsWith(FOREIGN_PRINCIPAL)) {
    const named = principal.slice(FOREIGN_PRINCIPAL.length);
    const cut = named.indexOf(':');
    if (cut <= 0 || cut === named.length - 1) return null;
    return { _tag: 'Foreign', harness: named.slice(0, cut), key: named.slice(cut + 1), projectId };
  }
  return null;
};
