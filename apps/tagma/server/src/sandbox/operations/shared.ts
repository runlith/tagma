import { OPERATOR_PRINCIPAL, signerPrincipal } from '../../platform/contract/wire/actor.js';
import type { Caller } from '../../platform/contract/wire/caller.js';
import type { Unblock } from '../../platform/contract/wire/refusal.js';
import type { GuestLimits } from '../contract/wire/sandbox.js';

export const DEFAULT_GUEST_LIMITS: GuestLimits = {
  pids: 512,
  memory: '2g',
  cpus: '2',
};

export const SELECTION_WAYS: Unblock = ['name ONE source: a commit, an empty tree, or a prepared tree', 'name each dependency path once'];

export function sourceConflict(input: {
  readonly commit?: string | undefined;
  readonly empty?: boolean | undefined;
  readonly preparedTree?: string | undefined;
  readonly exclude?: readonly string[] | undefined;
  readonly setup?: readonly (readonly string[])[] | undefined;
  readonly dependencies?: readonly string[] | undefined;
}): string | null {
  const duplicate = input.dependencies?.find((dependency, at, all) => all.indexOf(dependency) !== at);
  if (duplicate !== undefined) return `dependency ${JSON.stringify(duplicate)} is named twice`;
  if (input.preparedTree !== undefined) {
    const beside = [
      input.commit === undefined ? null : 'commit',
      input.empty === true ? 'empty' : null,
      input.exclude === undefined ? null : 'exclude',
      input.setup === undefined ? null : 'setup',
      input.dependencies === undefined ? null : 'dependencies',
    ].filter((named): named is string => named !== null);
    return beside.length === 0 ? null : `a prepared tree decides what its copy carries; ${beside.join(', ')} cannot be asked for beside it`;
  }
  if (input.empty === true && input.commit !== undefined) {
    return 'a source is taken from a commit or from no tree at all, never from both';
  }
  return null;
}

export const principalOf = (caller: Caller): string =>
  caller.actor.kind === 'operator' ? OPERATOR_PRINCIPAL : signerPrincipal(caller.actor);
