import type { DeadlineChange } from '@runlith/executions/protocol/command';
import type { ExecutionRef } from '@runlith/executions/protocol/execution';
import { TerminalRefused } from '../contract/wire/refusals.js';
import type { TerminalActor } from '../contract/wire/terminals.js';
import { type SessionIdentity, sessionName } from '../../platform/contract/wire/session.js';
import type { CommandRelation, CommandSubject } from '../contract/wire/commandSubject.js';
import type { CommandRecord } from '../contract/wire/commands.js';

export type CommandOperation =
  | { readonly _tag: 'Observe'; readonly execution: ExecutionRef }
  | { readonly _tag: 'Await'; readonly execution: ExecutionRef }
  | { readonly _tag: 'Launch'; readonly owner: CommandSubject }
  | { readonly _tag: 'Stop'; readonly execution: ExecutionRef }
  | {
      readonly _tag: 'Revise';
      readonly execution: ExecutionRef;
      readonly current: { readonly executionMs?: number; readonly ceilingMs?: number };
      readonly change: DeadlineChange;
      readonly exception: boolean;
    };

export type CommandEligibilityRequest = {
  readonly actor: TerminalActor;
  readonly actorKnown: boolean;
  readonly scope: number;
  readonly relation: CommandRelation;
  readonly origin?: CommandRecord | null;
  readonly namedOwner?: { readonly projectId: number; readonly live: boolean } | null;
  readonly act: CommandOperation;
  readonly identity: SessionIdentity['Service'];
};

export type EligibilityVerdict = { readonly _tag: 'Eligible' } | { readonly _tag: 'Refused'; readonly refusal: TerminalRefused };

const eligible: EligibilityVerdict = { _tag: 'Eligible' };

const refuse = (reason: TerminalRefused['reason'], message: string): EligibilityVerdict => ({
  _tag: 'Refused',
  refusal: new TerminalRefused({ reason, message }),
});

export function reviseDirection(current: { readonly executionMs?: number }, change: DeadlineChange): 'shorten' | 'extend' | 'remaining' {
  if (change._tag === 'Remaining') return 'remaining';
  return current.executionMs === undefined || change.executionMs <= current.executionMs ? 'shorten' : 'extend';
}

const named = (actor: TerminalActor, identity: SessionIdentity['Service']): string =>
  actor._tag === 'Thread'
    ? `thread ${actor.threadId}`
    : actor._tag === 'Foreign'
      ? `foreign session ${sessionName({ harness: actor.harness, key: actor.key }, identity)}`
      : 'the operator';

export function commandEligibility(request: CommandEligibilityRequest): EligibilityVerdict {
  const { actor, scope, origin, act } = request;
  if (!request.actorKnown) {
    return refuse('ineligible', `This installation cannot place ${named(actor, request.identity)}; nothing can be managed from it.`);
  }
  if (act._tag !== 'Launch' && origin === null) {
    return refuse('no-command', `This installation holds no command under ${act.execution.execution}; read the inventory again.`);
  }
  if (origin !== undefined && origin !== null && origin.projectId !== scope) {
    return refuse('foreign-project', `This command belongs to project ${origin.projectId}; a known id does not reach across projects.`);
  }
  switch (act._tag) {
    case 'Observe':
    case 'Await':
      return eligible;
    case 'Launch':
      return launch(request, act.owner);
    case 'Stop':
      return eligible;
    case 'Revise':
      return revise(request, act);
  }
}

function launch(request: CommandEligibilityRequest, owner: CommandSubject): EligibilityVerdict {
  if (request.actor._tag === 'Thread' && request.relation !== 'own') {
    return refuse(
      'unrelated',
      `A launch takes its own ownership, and ${named(request.actor, request.identity)} does not own this one; it cannot hand a command to another owner at birth.`,
    );
  }
  if (owner._tag !== 'Thread') return eligible;
  const standing = request.namedOwner;
  if (standing === null || standing === undefined) {
    return refuse(
      'no-owner',
      'This installation holds no thread under the named owner; ownership cannot land on a thread that does not exist.',
    );
  }
  if (!standing.live) {
    return refuse('no-owner', 'The named owner is not live, so it cannot take ownership.');
  }
  if (standing.projectId !== request.scope) {
    return refuse('foreign-project', `The named owner works project ${standing.projectId}; ownership never moves work between projects.`);
  }
  return eligible;
}

function revise(request: CommandEligibilityRequest, act: Extract<CommandOperation, { readonly _tag: 'Revise' }>): EligibilityVerdict {
  if (act.exception) return eligible;
  const ceilingMs = act.current.ceilingMs;
  if (act.change._tag !== 'Total' || ceilingMs === undefined || act.change.executionMs <= ceilingMs) return eligible;
  return refuse(
    'ceiling',
    `The rule this command started under holds ${ceilingMs} ms of execution; ${act.change.executionMs} ms cannot extend past it without an operator exception.`,
  );
}
