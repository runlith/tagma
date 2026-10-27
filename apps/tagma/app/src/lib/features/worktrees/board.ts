import type { WorktreeFact, WorktreePlace, WorktreeRow } from '@tagma/server/worktrees/contract/wire/rows';
import { timeCompact } from '$lib/shared/time.js';
import { baseName } from './BaseReading.svelte.js';
import { factTitle } from './factTitle.js';
import { counted } from './finishWords.js';
import { stateOf } from './step.js';

export type Group = 'needs' | 'working' | 'quiet' | 'clean';

export const GROUPS: readonly { readonly id: Group; readonly words: string }[] = [
  { id: 'needs', words: 'Needs you' },
  { id: 'working', words: 'Working' },
  { id: 'quiet', words: 'Quiet' },
  { id: 'clean', words: 'To clean up' },
];

export type PhraseKind =
  | 'queued-merge'
  | 'stopped-merge'
  | 'gone'
  | 'merged'
  | 'waits'
  | 'conflicts'
  | 'ready'
  | 'behind'
  | 'unreadable'
  | 'reading'
  | 'uncommitted'
  | 'nothing';

export type Phrase = {
  readonly kind: PhraseKind;
  readonly words: string;
  readonly ink: string;
  readonly asides: readonly string[];
  readonly hint: string | null;
  readonly pending: boolean;
};

const MUTED = 'text-muted-foreground';

const LOUD = {
  failure: 'font-medium text-destructive',
  you: 'font-medium text-status-open',
  done: 'font-medium text-status-done',
  stale: 'font-medium text-status-stale',
} as const;

export function groupOf(place: WorktreePlace, facts: WorktreeRow | null, acting: boolean): Group {
  if (acting || place.pending?.state === 'waiting') return 'working';
  if (place.pending?.state === 'stopped') return 'needs';
  switch (stateOf(place, facts)) {
    case 'missing':
    case 'merged':
      return 'clean';
    case 'waiting':
    case 'conflicts':
    case 'ready':
    case 'behind':
    case 'unread':
      return 'needs';
    case 'working':
      return 'working';
    default:
      return 'quiet';
  }
}

const staleOf = (facts: WorktreeRow): WorktreeFact | null => {
  const fact = facts.stateFact.state !== 'current' ? facts.stateFact : facts.kind === 'tagma' ? facts.mergeFact : facts.stateFact;
  return (fact.state === 'previous' || fact.state === 'queued') && fact.takenAt !== null ? fact : null;
};

const checked = (fact: WorktreeFact, now: number): string => {
  const age = timeCompact(new Date(fact.takenAt ?? now).toISOString(), now);
  return age === 'now' ? 'checked just now' : `checked ${age} ago`;
};

export function phraseOf(place: WorktreePlace, facts: WorktreeRow | null, now: number): Phrase | null {
  const into = baseName(place);
  const stale = facts === null ? null : staleOf(facts);
  const said = (kind: PhraseKind, words: string, ink: string, asides: readonly string[] = []): Phrase => ({
    kind,
    words,
    ink,
    asides: stale === null ? asides : [...asides, checked(stale, now)],
    hint: stale === null ? null : factTitle(stale),
    pending: false,
  });
  if (place.pending?.state === 'waiting')
    return { kind: 'queued-merge', words: `Merge waits for ${into}`, ink: MUTED, asides: [], hint: null, pending: true };
  if (place.pending?.state === 'stopped')
    return {
      kind: 'stopped-merge',
      words: 'Merge stopped',
      ink: LOUD.failure,
      asides: [],
      hint: place.pending.refusal?.message ?? null,
      pending: false,
    };
  const state = stateOf(place, facts);
  const uncommitted = facts?.uncommitted ?? 0;
  if (state === 'unread')
    return { kind: 'unreadable', words: 'Checkout can’t be read', ink: LOUD.failure, asides: [], hint: null, pending: false };
  if (state === 'reading') return { kind: 'reading', words: 'Reading', ink: MUTED, asides: [], hint: null, pending: true };
  if (place.kind === 'main') return uncommitted > 0 ? said('uncommitted', counted(uncommitted, 'uncommitted file'), MUTED) : null;
  switch (state) {
    case 'missing':
      return { kind: 'gone', words: 'Folder is gone', ink: MUTED, asides: [], hint: null, pending: false };
    case 'merged':
      return said('merged', `Merged into ${into}`, MUTED);
    case 'waiting':
      return { kind: 'waits', words: 'Waits for you', ink: LOUD.you, asides: [], hint: null, pending: false };
    case 'conflicts':
      return said('conflicts', `Conflicts with ${into}`, LOUD.failure);
    case 'ready': {
      const ready = said('ready', 'Ready to merge', LOUD.done, facts?.ahead == null ? [] : [counted(facts.ahead, 'commit')]);
      const merge = facts?.mergeFact.state;
      if (merge === 'queued')
        return { ...ready, asides: [...ready.asides.filter((one) => !one.startsWith('checked')), 'checking'], pending: true };
      if (merge === 'untaken') return { ...ready, asides: [...ready.asides, 'not checked yet'] };
      if (facts?.check === 'format-behind') return { ...ready, asides: [...ready.asides, 'format pending'] };
      return ready;
    }
    case 'behind':
      return said('behind', `${facts?.behind ?? 0} behind ${into}`, LOUD.stale);
    default:
      if (uncommitted > 0) return said('uncommitted', counted(uncommitted, 'uncommitted file'), MUTED);
      if (facts?.ahead === 0 && facts.uncommitted === 0) return said('nothing', 'Nothing to merge', MUTED);
      return null;
  }
}
