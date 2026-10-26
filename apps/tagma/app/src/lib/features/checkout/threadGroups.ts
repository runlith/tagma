import type { Holding } from '@tagma/server/change-record/contract/wire/holdings';
import { type CheckoutEntry, type CheckoutLines, type Holder, holderKey } from '@tagma/server/workspace/contract/wire/checkout';
import { holderName, threadName, type ThreadLabel } from '$lib/features/worktrees/holders.js';
import type { CheckoutSection } from './Selection.svelte.js';
import type { ChangeItem } from './changeItem.js';

export type ThreadGroupEntry = ChangeItem & {
  readonly staged: boolean;
  readonly unstaged: boolean;
  readonly entry: CheckoutEntry;
};

export type ThreadGroup = {
  readonly key: string;
  readonly holder: Holder | null;
  readonly name: string;
  readonly entries: readonly ThreadGroupEntry[];
};

const NOBODY = { key: 'nobody', name: 'Other changes' } as const;

const YOURS = 'Your changes';

const UNPROVEN = { key: 'unproven', name: 'Not verified' } as const;

const joined = (one: CheckoutLines, two: CheckoutLines): CheckoutLines => {
  if (typeof one === 'string') return one;
  if (typeof two === 'string') return two;
  return { added: one.added + two.added, removed: one.removed + two.removed };
};

export type HoldingOf = (path: string) => Holding | undefined;

export function threadGroups(
  sections: readonly CheckoutSection[],
  holdingOf: HoldingOf,
  labelOf: ThreadLabel = () => null,
): readonly ThreadGroup[] {
  const paths = new Map<string, { entry: CheckoutEntry; lines: CheckoutLines; staged: boolean; unstaged: boolean }>();
  for (const section of sections) {
    if (section.name === 'graph' || section.name === 'conflicts') continue;
    const staged = section.name === 'staged';
    for (const entry of section.entries) {
      const held = paths.get(entry.path);
      if (held === undefined) {
        paths.set(entry.path, { entry, lines: entry.lines, staged, unstaged: !staged });
        continue;
      }
      held.lines = joined(held.lines, entry.lines);
      held.staged ||= staged;
      held.unstaged ||= !staged;
    }
  }

  const groups = new Map<string, { key: string; holder: Holder | null; name: string; entries: ThreadGroupEntry[] }>();
  const place = (key: string, holder: Holder | null, name: string, item: ThreadGroupEntry): void => {
    const group = groups.get(key) ?? { key, holder, name, entries: [] };
    group.entries.push(item);
    groups.set(key, group);
  };
  for (const [path, held] of paths) {
    const item: ThreadGroupEntry = {
      path,
      status: held.entry.status,
      lines: held.lines,
      staged: held.staged,
      unstaged: held.unstaged,
      entry: held.entry,
    };
    const verdict = holdingOf(path)?.verdict;
    if (verdict?.verdict === 'unknown') {
      place(UNPROVEN.key, null, UNPROVEN.name, item);
      continue;
    }
    const hands = verdict?.hands ?? [];
    for (const hand of hands)
      place(
        `holder:${holderKey(hand.holder)}`,
        hand.holder,
        hand.holder.kind === 'operator' ? YOURS : threadName(hand.holder.thread, labelOf),
        item,
      );
    if (hands.length === 0 || (verdict?.nobody.length ?? 0) > 0) place(NOBODY.key, null, NOBODY.name, item);
  }

  const rank = (group: ThreadGroup): number =>
    group.holder?.kind === 'operator' ? 0 : group.holder !== null ? 1 : group.key === UNPROVEN.key ? 2 : 3;
  return [...groups.values()].sort((one, two) => rank(one) - rank(two) || one.name.localeCompare(two.name));
}

export type Writer = { readonly holder: Holder; readonly name: string };

export type Editing = { readonly writers: readonly Writer[]; readonly what: string };

export function stillEditing(staged: readonly CheckoutEntry[], holdingOf: HoldingOf, labelOf: ThreadLabel): Editing | null {
  const files = new Map<string, { holder: Holder; files: number }>();
  let held = 0;
  let first: string | null = null;
  for (const entry of staged) {
    const verdict = holdingOf(entry.path)?.verdict;
    if (verdict?.verdict !== 'proven') continue;
    const hands = verdict.hands.filter((hand) => hand.writing);
    if (hands.length === 0) continue;
    held += 1;
    first ??= entry.path;
    for (const hand of hands) {
      const key = holderKey(hand.holder);
      const writer = files.get(key) ?? { holder: hand.holder, files: 0 };
      writer.files += 1;
      files.set(key, writer);
    }
  }
  if (first === null) return null;
  const writers = [...files.values()]
    .sort((one, two) => two.files - one.files)
    .map((writer) => ({ holder: writer.holder, name: holderName(writer.holder, labelOf) }));
  return { writers, what: held === 1 ? first.slice(first.lastIndexOf('/') + 1) : `${held} staged files` };
}
