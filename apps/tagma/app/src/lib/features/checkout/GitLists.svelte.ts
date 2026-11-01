import type { AuthorshipSide } from '@tagma/server/change-record/contract/wire/authorship';
import type { CheckoutEntry, CheckoutLines } from '@tagma/server/workspace/contract/wire/checkout';
import { Service } from '@runlith/layer/key';
import { ReaderMarks } from '$lib/shared/reading/ReaderMarks.svelte.js';
import { ThreadNames } from '$lib/shared/threads/Names.svelte.js';
import { shownOrder } from './changeItem.js';
import { BY_THREAD, byThread, groupedIn } from './grouping.js';
import { Holdings } from './Holdings.svelte.js';
import { CheckoutRepo } from './Repo.js';
import { Checkout } from './Selection.svelte.js';
import { stillEditing, threadGroups, type ThreadGroup, type ThreadGroupEntry } from './threadGroups.js';

export type Side = AuthorshipSide | null;

export type Walked = { readonly path: string; readonly lines: CheckoutLines; readonly side: Side };

export type Standing = { readonly path: string; readonly commit: string | null; readonly side: Side };

export const sideOf = (item: ThreadGroupEntry): Side => (item.staged ? 'staged' : 'unstaged');

const walkKey = (item: { readonly path: string; readonly side: Side }): string => `${item.side ?? ''}\u0000${item.path}`;

export class GitLists extends Service<GitLists>()('GitLists', { tier: 'graph' }) {
  static *make() {
    return new GitLists(yield* Checkout, yield* Holdings, yield* ReaderMarks, yield* ThreadNames, yield* CheckoutRepo);
  }

  constructor(
    private readonly checkout: Checkout,
    private readonly holdings: Holdings,
    private readonly marks: ReaderMarks,
    private readonly names: ThreadNames,
    private readonly repo: CheckoutRepo,
  ) {
    super();
  }

  private entriesOf(name: 'conflicts' | 'staged' | 'changes' | 'graph'): readonly CheckoutEntry[] {
    return this.checkout.sections.find((section) => section.name === name)?.entries ?? [];
  }

  loaded = $derived.by(() => this.checkout.row !== null);

  conflicts = $derived(this.entriesOf('conflicts'));
  staged = $derived(this.entriesOf('staged'));
  changes = $derived(this.entriesOf('changes'));
  graph = $derived(this.entriesOf('graph'));

  anything = $derived(this.conflicts.length + this.staged.length + this.changes.length + this.graph.length > 0);

  grouped = $derived.by(() => groupedIn(this.marks));

  threadMode = $derived.by(() => byThread(this.marks.grouping.get(BY_THREAD)));

  groups = $derived.by<readonly ThreadGroup[]>(() =>
    this.threadMode
      ? threadGroups(
          this.checkout.sections,
          (path) => this.holdings.of(path),
          (thread) => this.names.of(thread)?.label ?? null,
        )
      : [],
  );

  editing = $derived.by(() =>
    stillEditing(
      this.staged,
      (path) => this.holdings.of(path),
      (thread) => this.names.of(thread)?.label ?? null,
    ),
  );

  keyOf(item: { readonly path: string; readonly side: Side }): string {
    return this.threadMode ? item.path : walkKey(item);
  }

  entriesAt(open: Standing): readonly CheckoutEntry[] {
    if (open.commit !== null) return [];
    const within =
      open.side === 'staged'
        ? this.staged
        : open.side === 'unstaged'
          ? this.changes
          : [...this.changes, ...this.staged, ...this.conflicts, ...this.graph];
    return within.filter((one) => one.path === open.path);
  }

  stands(path: string): { readonly staged: boolean; readonly changes: boolean; readonly other: boolean } {
    const has = (entries: readonly CheckoutEntry[]): boolean => entries.some((one) => one.path === path);
    return { staged: has(this.staged), changes: has(this.changes), other: has(this.conflicts) || has(this.graph) };
  }

  walk(open: Standing): readonly Walked[] | null {
    const rootId = this.checkout.row?.rootId ?? null;
    if (rootId === null) return null;
    const of = (entries: readonly { readonly path: string; readonly lines: CheckoutLines }[], side: Side): readonly Walked[] =>
      shownOrder(entries, this.grouped).map((one) => ({ path: one.path, lines: one.lines, side }));
    let within: readonly Walked[];
    if (open.commit !== null) {
      within = of(this.repo.commitReading.key({ projectId: this.checkout.projectId, rootId, commit: open.commit }).data?.files ?? [], null);
    } else if (this.graph.some((one) => one.path === open.path)) {
      within = of(this.graph, null);
    } else if (this.threadMode) {
      const shown = [
        ...of(this.conflicts, null),
        ...this.groups.flatMap((group) =>
          shownOrder(group.entries, this.grouped).map((item) => ({ path: item.path, lines: item.lines, side: sideOf(item) })),
        ),
      ];
      const seen = new Set<string>();
      within = shown.filter((one) => {
        if (seen.has(one.path)) return false;
        seen.add(one.path);
        return true;
      });
    } else {
      within = [...of(this.conflicts, null), ...of(this.staged, 'staged'), ...of(this.changes, 'unstaged')];
    }
    const at = this.keyOf(open);
    return within.some((one) => this.keyOf(one) === at) ? within : null;
  }
}
