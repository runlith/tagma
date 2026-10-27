import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { REFUSAL_CODES, type TerminalRefused, type TerminalRefusalCode } from '../contract/wire/refusals.js';
import type { TerminalFailure } from '../contract/service/terminals.js';

type Unanswered = Exclude<
  TerminalFailure,
  {
    readonly _tag:
      | 'TerminalRefused'
      | 'TerminalUnavailable'
      | 'WireUnavailable'
      | 'WireLost'
      | 'WireUnreadable'
      | 'WireInvalid'
      | 'WireFailed'
      | 'HostRefused';
  }
>;

export type TerminalGateCode =
  | TerminalRefusalCode
  | `terminal-unavailable-${Extract<TerminalFailure, { readonly _tag: 'TerminalUnavailable' }>['owner']}`
  | `terminal-host-unavailable-${Extract<TerminalFailure, { readonly _tag: 'WireUnavailable' }>['kind']}`
  | 'terminal-host-closed'
  | 'terminal-host-protocol'
  | `terminal-host-faulted-${Extract<TerminalFailure, { readonly _tag: 'WireFailed' }>['fault']['kind']}`
  | `terminal-host-refused-${Extract<TerminalFailure, { readonly _tag: 'HostRefused' }>['refusal']['_tag']}`
  | `terminal-${Unanswered['_tag']}`;

const REFUSAL_WAYS_OUT: Record<TerminalRefused['reason'], string> = {
  'not-holder': 'type into an execution this thread holds, or move this one into its custody with transfer_terminal first',
  destination: 'name a live thread of this execution’s project as the destination, or omit it to hand custody to the operator',
  'no-grant':
    'type again through a fresh lane into this terminal: the right to type belongs to one writer and lane, and none stands behind this one',
  stale:
    'where this act typed, the right it rode has ended — the terminal changed hands, its run ended or the permissions were republished: type again through a fresh lane. Where it was a launch over a resolved target, the target moved after it was resolved: resolve it again and send the act again',
  'no-binding':
    'send the act again once this installation holds the execution host’s custody: the host opens no lane while nobody holds it, and nothing here was opened',
  ineligible:
    'act under an identity this server can place: run it from a shell of this server’s own session, which carries its grant, or outside the harness whose session variable is set',
  'operation-capacity':
    'read the installation operation-key counts in read_terminals or read_commands; in-flight outcomes must settle, and uncertain admissions need server reconciliation. If they remain unresolved, report the server store to the operator: closing a terminal or replacing the host does not settle these keys',
  capacity:
    'free what this act needs, then act again: close a terminal, a screen view or a lane nothing types through any more, or end work outside Tagma that is holding this machine’s processes or terminals. Records of finished executions hold no place — the host gives those back itself. When it is the SCREEN that does not fit, restarting the execution host brings it up at the size this installation declares',
  memory:
    'end an execution you have finished with: a reserve is funded for a running child and comes back when it exits, and the history a finished one still holds is reclaimed on its own. Raising the host’s memory share is the operator’s act on the settings page',
  'host-state':
    'read_machine_state names the host acceptance and its failure. If the host does not recover, have the operator rebuild the installation and restart Tagma',
  'host-incompatible':
    'this server stands beside the execution host of another build, which does not take it, so nothing starts until the operator restarts the host or opens the build it takes: read_machine_state names both and what restarting the host ends under newHost',
  'foreign-project':
    'ask from the project that holds this execution: its project is fixed for its whole life, so nothing here is retried and no key answers it',
  'operation-conflict': 'read the operation by its own key instead of sending it again',
  'operation-expired': 'read the operation by its own key instead of sending it again',
  ceiling: 'ask within the ceiling the refusal names, or have the operator record an exception for the execution',
  'service-denied': 'have the operator start service-owned work: it runs under the operator’s own authority',
  'stale-authority': 'read the command again and repeat the act on the fresh reading',
  unrelated: 'launch the command under this thread’s own ownership; the operator alone names another owner at birth',
  'no-command': 'read the command inventory again: the name is not held here',
  'no-owner': 'name a live thread of this project to own the command',
  'operator-only': 'have the operator record the exception',
  'selection-changed': 'read the first page again under the selection you mean, and carry that page’s own cursor forward',
  'record-lost':
    'nothing here can be retried: the record went with the host generation that held it. Read the execution’s own row, which says it ended and its record is unavailable, instead of following its bytes',
};

const faultWayOut = (kind: Extract<TerminalFailure, { _tag: 'WireFailed' }>['fault']['kind']): string => {
  switch (kind) {
    case 'connections-exceeded':
    case 'requests-exceeded':
    case 'subscriptions-exceeded':
    case 'credit-exceeded':
      return 'wait for ceiling to free and ask again; raising the ceiling is the installation’s act';
    case 'unknown-subscription':
    case 'unknown-request':
      return 'read the inventory again: the name is not held by the host';
    case 'oversized':
      return 'send less in one act: this frame exceeds what the wire carries';
    case 'unauthenticated':
    case 'already-authenticated':
      return 'fix the installation’s credentials rather than the call';
    case 'unsupported-version':
    case 'unsupported-family':
    case 'malformed':
      return 'fix the installation rather than the call: versions and framing do not change under a retry';
    default:
      return 'fix the installation rather than the call';
  }
};

const LANE_REFUSALS: ReadonlySet<string> = new Set(['HostConflict', 'CustodyConflict', 'Unauthorized']);

export const refusesLane = (refusal: { readonly _tag: string }): boolean => LANE_REFUSALS.has(refusal._tag);

export const terminalRefusal = <Code extends string = string>(
  failure: TerminalFailure | GateRefusal<Code>,
): GateRefusal<Code | TerminalGateCode> => {
  if (failure instanceof GateRefusal) return failure;
  switch (failure._tag) {
    case 'TerminalRefused':
      return new GateRefusal(REFUSAL_CODES[failure.reason], failure.message, [REFUSAL_WAYS_OUT[failure.reason]]);
    case 'TerminalUnavailable':
      return new GateRefusal(`terminal-unavailable-${failure.owner}` as const, failure.message, [
        'ask again once that owner answers; nothing here says the work does not exist',
      ]);
    case 'WireUnavailable': {
      const kind = failure.kind;
      return new GateRefusal(`terminal-host-unavailable-${kind}` as const, failure.reason, [
        kind === 'unreachable'
          ? 'ask again once the host answers; the registration stands and is never replaced over this'
          : kind === 'absent'
            ? 'install the execution host rather than resending the call: nothing answers because nothing was installed here'
            : 'fix the installation rather than the call: its registration cannot be acted on, or this caller holds no key for the role it chose',
      ]);
    }
    case 'WireLost':
      return new GateRefusal('terminal-host-closed', failure.reason, [
        failure.sent
          ? 'read the operation by its key: a lost reply is recovered, never resent'
          : 'send it again: the frame never left this process, so nothing was applied',
      ]);
    case 'WireUnreadable':
    case 'WireInvalid':
      return new GateRefusal('terminal-host-protocol', failure.detail, [
        'report it against the host installation rather than retrying the call',
      ]);
    case 'WireFailed':
      return new GateRefusal(`terminal-host-faulted-${failure.fault.kind}` as const, `${failure.fault.kind}: ${failure.fault.detail}`, [
        faultWayOut(failure.fault.kind),
      ]);
    case 'HostRefused':
      return new GateRefusal(`terminal-host-refused-${failure.refusal._tag}` as const, failure.refusal.reason, [
        failure.refusal._tag === 'InputYielding'
          ? 'continue this input when the successor logic answers; this logic admitted none of it'
          : failure.refusal._tag === 'CustodyConflict'
            ? 'read this terminal again and send the act over what stands: its custody is with another scope now, and nothing was applied'
            : failure.refusal._tag === 'UnknownExecution'
              ? 'read the terminal list again: this execution is over, nothing types into it, and a new one is started instead'
              : failure.refusal._tag === 'StreamMissing'
                ? 'read a stream this record carries: a pipes record sealed before output was kept carries stdout and stderr only'
                : 'the host decided this before any effect; nothing was started',
      ]);
    default:
      return new GateRefusal(
        `terminal-${failure._tag}` as const,
        'message' in failure && typeof failure.message === 'string'
          ? failure.message
          : `the ${failure._tag} owner refused this terminal act`,
        ['read that owner’s answer and resolve it there; this door does not decide for it'],
      );
  }
};
