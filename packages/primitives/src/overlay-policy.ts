import type { Fact } from '@runlith/layer/condition';

export type OverlayAs = 'dialog' | 'launcher';

export type OverlayMatcher = {
  readonly id?: string;
  readonly as?: OverlayAs;
  readonly tags?: readonly string[];
  readonly when?: Fact;
};

export type OverlayPolicy = {
  readonly priority: number;
  readonly unblockDelayMs?: number;
  readonly tags?: readonly string[];
  readonly blockedBy?: readonly Fact[];
  readonly heldBy?: readonly Fact[];
  readonly allowCoexistWith?: readonly OverlayMatcher[];
  readonly disallowCoexistWith?: readonly OverlayMatcher[];
  readonly suspends?: readonly OverlayMatcher[];
  readonly yieldsTo?: readonly OverlayMatcher[];
};

export type OverlaySpec = {
  readonly id: string;
  readonly as: OverlayAs;
  readonly arbitrated: boolean;
  readonly within?: string;
  readonly priority: number;
  readonly unblockDelayMs: number;
  readonly tags: readonly string[];
  readonly blockedBy: readonly Fact[];
  readonly heldBy: readonly Fact[];
  readonly allowCoexistWith: readonly OverlayMatcher[];
  readonly disallowCoexistWith: readonly OverlayMatcher[];
  readonly suspends: readonly OverlayMatcher[];
  readonly yieldsTo: readonly OverlayMatcher[];
};

const DIALOG_UNBLOCK_DELAY_MS = 500;

function unblockDelayOf(as: OverlayAs, policy: OverlayPolicy): number {
  return policy.unblockDelayMs ?? (as === 'dialog' ? DIALOG_UNBLOCK_DELAY_MS : 0);
}

export function specOf(id: string, as: OverlayAs, policy?: OverlayPolicy, within?: string): OverlaySpec {
  if (!policy) {
    return {
      id,
      as,
      arbitrated: false,
      within,
      priority: 0,
      unblockDelayMs: 0,
      tags: [],
      blockedBy: [],
      heldBy: [],
      allowCoexistWith: [],
      disallowCoexistWith: [],
      suspends: [],
      yieldsTo: [],
    };
  }

  return {
    id,
    as,
    arbitrated: true,
    within,
    priority: policy.priority,
    unblockDelayMs: unblockDelayOf(as, policy),
    tags: policy.tags ?? [],
    blockedBy: policy.blockedBy ?? [],
    heldBy: policy.heldBy ?? [],
    allowCoexistWith: policy.allowCoexistWith ?? [],
    disallowCoexistWith: policy.disallowCoexistWith ?? [],
    suspends: policy.suspends ?? [],
    yieldsTo: policy.yieldsTo ?? [],
  };
}

export type ReadFact = (fact: Fact) => boolean;

export function matches(matchers: readonly OverlayMatcher[], spec: OverlaySpec, read: ReadFact): boolean {
  return matchers.some((matcher) => {
    if (matcher.when && !read(matcher.when)) return false;
    if (matcher.id !== undefined && matcher.id !== spec.id) return false;
    if (matcher.as !== undefined && matcher.as !== spec.as) return false;
    if (matcher.tags && !matcher.tags.every((tag) => spec.tags.includes(tag))) return false;
    return true;
  });
}

function coexistByDefault(left: OverlayAs, right: OverlayAs): boolean {
  return left !== right || left === 'launcher';
}

export function canCoexist(left: OverlaySpec, right: OverlaySpec, read: ReadFact): boolean {
  if (left.within === right.id || right.within === left.id) return true;
  if (matches(left.disallowCoexistWith, right, read) || matches(right.disallowCoexistWith, left, read)) return false;
  if (matches(left.allowCoexistWith, right, read) || matches(right.allowCoexistWith, left, read)) return true;
  return coexistByDefault(left.as, right.as);
}

export type Relation = 'coexist' | 'suspend' | 'wait';

export function relate(candidate: OverlaySpec, active: OverlaySpec, read: ReadFact): Relation {
  const pushes = matches(candidate.suspends, active, read) || matches(active.yieldsTo, candidate, read);
  const yields = matches(candidate.yieldsTo, active, read) || matches(active.suspends, candidate, read);

  if (candidate.arbitrated && !active.arbitrated) {
    if (yields) return 'wait';
    return canCoexist(candidate, active, read) ? 'coexist' : 'wait';
  }

  if (pushes || yields) {
    if (pushes && !yields) return 'suspend';
    if (yields && !pushes) return 'wait';
    return candidate.priority > active.priority ? 'suspend' : 'wait';
  }

  if (canCoexist(candidate, active, read)) return 'coexist';

  return candidate.priority > active.priority ? 'suspend' : 'wait';
}
