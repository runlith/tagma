import type { Principal } from '@runlith/executions/protocol/custody';
import type { ThreadId } from '../../platform/contract/wire/thread.js';
import { TerminalRefused } from '../contract/wire/refusals.js';
import { principalOf } from './principals.js';
import { type TerminalActor } from '../contract/wire/terminals.js';

export type TerminalDestination =
  | { readonly _tag: 'Operator' }
  | {
      readonly _tag: 'Thread';
      readonly threadId: ThreadId;
      readonly projectId: number;
      readonly live: boolean;
    };

export type TerminalDestinationRef = { readonly _tag: 'Operator' } | { readonly _tag: 'Thread'; readonly threadId: ThreadId };

export type TerminalOperation =
  | { readonly _tag: 'Observe' }
  | { readonly _tag: 'Start'; readonly holder: Principal }
  | { readonly _tag: 'Input' }
  | { readonly _tag: 'Signal' }
  | { readonly _tag: 'Stop' }
  | { readonly _tag: 'Transfer'; readonly to: TerminalDestination };

export type TerminalInstruction =
  | Exclude<TerminalOperation, { readonly _tag: 'Transfer' }>
  | { readonly _tag: 'Transfer'; readonly to: TerminalDestinationRef };

export type TerminalState = {
  readonly projectId: number;
  readonly holder?: Principal;
};

export type TerminalRequest = {
  readonly actor: TerminalActor;
  readonly standing: TerminalState;
  readonly act: TerminalOperation;
};

export type PolicyVerdict = { readonly _tag: 'Eligible' } | { readonly _tag: 'Refused'; readonly refusal: TerminalRefused };

const eligible: PolicyVerdict = { _tag: 'Eligible' };

const refuse = (reason: TerminalRefused['reason'], message: string): PolicyVerdict => ({
  _tag: 'Refused',
  refusal: new TerminalRefused({ reason, message }),
});

const inProject = (actor: TerminalActor, standing: TerminalState): boolean =>
  actor._tag === 'Operator' || actor.projectId === standing.projectId;

export function terminalPolicy(request: TerminalRequest): PolicyVerdict {
  const { actor, standing, act } = request;
  if (!inProject(actor, standing)) {
    return refuse(
      'foreign-project',
      `This actor belongs to another project than execution project ${standing.projectId}; a known id does not reach across projects.`,
    );
  }
  switch (act._tag) {
    case 'Observe':
      return eligible;
    case 'Start':
      return act.holder === principalOf(actor)
        ? eligible
        : refuse('ineligible', 'A start takes its own custody; handing an execution to another holder is a transfer.');
    case 'Transfer':
      return transfer(standing, act.to);
    default:
      return eligible;
  }
}

function transfer(standing: TerminalState, to: TerminalDestination): PolicyVerdict {
  if (to._tag === 'Thread') {
    if (to.projectId !== standing.projectId) {
      return refuse(
        'destination',
        `Execution project ${standing.projectId} does not hold thread ${to.threadId}; a transfer never moves work between projects.`,
      );
    }
    if (!to.live) {
      return refuse('destination', `Thread ${to.threadId} is not live, so it cannot take custody.`);
    }
  }
  return eligible;
}
