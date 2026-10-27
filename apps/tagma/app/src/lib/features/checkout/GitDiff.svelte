<script lang="ts">
  import type { AuthorshipSide } from '@tagma/server/change-record/contract/wire/authorship';
  import type { CheckoutLines } from '@tagma/server/workspace/contract/wire/checkout';
  import { Tabs } from '$lib/features/checkout/files/Tabs.svelte.js';
  import { type CheckoutTab, kindFor } from '$lib/features/checkout/files/tab.js';
  import { stepOf, weightMark } from './changeItem.js';
  import DiffTab from './DiffTab.svelte';
  import { GitLists, type Side } from './GitLists.svelte.js';
  import { Holdings } from './Holdings.svelte.js';
  import { CheckoutRepo } from './Repo.js';
  import { Checkout } from './Selection.svelte.js';

  let { tab }: { tab: CheckoutTab } = $props();

  const tabs = Tabs.use();
  const lists = GitLists.use();
  const holdings = Holdings.use();
  const repo = CheckoutRepo.use();
  const checkout = Checkout.use();

  const commit = $derived(tab.diff?.commit ?? null);
  const side = $derived<Side>(commit === null ? (tab.diff?.side ?? null) : null);
  const standing = $derived({ path: tab.path, commit, side });

  const entries = $derived(lists.entriesAt(standing));

  const halves = $derived.by<boolean>(() => {
    if (commit !== null || side === null) return false;
    const here = lists.stands(tab.path);
    return here.staged && here.changes;
  });

  const headLines = $derived.by<CheckoutLines | null>(() => {
    if (commit !== null) {
      return (
        repo.commitReading
          .key({ projectId: checkout.projectId, rootId: tab.rootId, commit })
          .data?.files.find((one) => one.path === tab.path)?.lines ?? null
      );
    }
    if (halves) return entries[0]?.lines ?? null;
    return holdings.of(tab.path)?.lines ?? null;
  });

  const mark = $derived(entries.length === 0 ? undefined : entries.map((one) => `${one.status}:${weightMark(one.lines)}`).join('|'));

  $effect(() => {
    if (commit !== null || !lists.loaded || entries.length > 0) return;
    const here = lists.stands(tab.path);
    const moved: Side | undefined = here.staged ? 'staged' : here.changes ? 'unstaged' : here.other ? null : undefined;
    if (moved === undefined) tabs.close(tab.id);
    else tabs.aimDiff(tab.id, { commit: null, side: moved });
  });

  const walk = $derived(lists.walk(standing));

  function step(direction: 1 | -1): void {
    if (walk === null) return;
    const next = stepOf(walk, lists.keyOf(standing), direction, lists.keyOf.bind(lists));
    if (next === null) return;
    tabs.open({ rootId: tab.rootId, path: next.path, kind: 'diff', diff: { commit, side: next.side } }, 'preview');
  }

  function turn(next: AuthorshipSide): void {
    tabs.aimDiff(tab.id, { commit: null, side: next });
  }
</script>

<DiffTab
  projectId={checkout.projectId}
  rootId={tab.rootId}
  path={tab.path}
  {commit}
  {side}
  onSide={halves ? turn : undefined}
  lines={headLines}
  {mark}
  onClose={() => tabs.close(tab.id)}
  onStep={walk === null ? undefined : step}
  onCommit={(picked) => tabs.aimDiff(tab.id, { commit: picked, side: picked === null ? side : null })}
  onOpenFile={(line) =>
    tabs.open(
      {
        rootId: tab.rootId,
        branch: tab.branch,
        path: tab.path,
        kind: kindFor(tab.path, line !== null),
        goto: line === null ? null : { line: Math.max(line - 1, 0), column: 0 },
      },
      'open',
    )}
/>
