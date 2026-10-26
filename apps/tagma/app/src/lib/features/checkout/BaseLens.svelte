<script lang="ts">
  import type { CheckoutLines } from '@tagma/server/workspace/contract/wire/checkout';
  import type { WorktreePlace } from '@tagma/server/worktrees/contract/wire/rows';
  import { untrack } from 'svelte';
  import { ReaderMarks } from '$lib/shared/reading/ReaderMarks.svelte.js';
  import { ThreadNames } from '$lib/shared/threads/Names.svelte.js';
  import { BaseReading, baseName, baseOf } from '$lib/features/worktrees/BaseReading.svelte.js';
  import { Live } from '$lib/wire/Live.js';
  import { Worktrees } from '$lib/features/worktrees/BoardState.svelte.js';
  import FactStamp from '$lib/features/worktrees/FactStamp.svelte';
  import { HoldingsReading } from '$lib/features/worktrees/HoldingsReading.svelte.js';
  import { inGraphTree, sectionsOf } from './Selection.svelte.js';
  import ChangeList from './ChangeList.svelte';
  import ChangeSection from './ChangeSection.svelte';
  import { insetOf } from './changeItem.js';
  import { groupedIn } from './grouping.js';
  import LineCount from './LineCount.svelte';
  import { SHORT_SHA } from './reading.js';
  import type { CommitRange } from './opened.js';
  import { threadGroups } from './threadGroups.js';

  let {
    row,
    projectId,
    selected,
    onOpen,
    onCounts,
  }: {
    row: WorktreePlace;
    projectId: number;
    selected: string | null;
    onOpen: (path: string, range: CommitRange | null, lines: CheckoutLines) => void;
    onCounts: (lines: CheckoutLines) => void;
  } = $props();

  const marks = ReaderMarks.use();
  const names = ThreadNames.use();
  const live = Live.use();
  const worktrees = Worktrees.use().window();
  const facts = $derived(worktrees.rowOf(row.rootId));
  const reading = new BaseReading(
    live,
    untrack(() => projectId),
  );

  const holdings = new HoldingsReading(
    live,
    untrack(() => projectId),
  );

  $effect(() => {
    reading.aim(row.rootId, baseOf(row));
  });
  $effect(() => {
    const root = row.rootId;
    untrack(() => holdings.aim({ root }));
  });
  $effect(() => () => {
    reading.close();
    holdings.close();
  });

  const grouped = $derived(groupedIn(marks));
  const state = $derived(reading.row);
  const compared = $derived(state?.compare ?? null);
  const committed = $derived(compared?.entries.filter((entry) => !inGraphTree(entry)) ?? []);
  const graphCount = $derived(compared?.entries.filter(inGraphTree).length ?? 0);
  const sections = $derived(state === null ? [] : sectionsOf(state));
  const conflicts = $derived(sections.find((section) => section.name === 'conflicts')?.entries ?? []);
  const groups = $derived(
    threadGroups(
      sections,
      (path) => holdings.of(path),
      (threadId) => names.of(threadId)?.label ?? null,
    ),
  );
  const shown = $derived.by<CheckoutLines | null>(() => {
    if (selected === null) return null;
    const entries = [...committed, ...conflicts, ...groups.flatMap((group) => group.entries)];
    return entries.find((entry) => entry.path === selected)?.lines ?? null;
  });
  $effect(() => {
    const lines = shown;
    if (lines !== null) untrack(() => onCounts(lines));
  });
  const nothing = $derived(state !== null && committed.length === 0 && groups.length === 0 && conflicts.length === 0);
</script>

<div class="grid content-start" data-base-lens={row.name} {@attach worktrees.observe(row.rootId)}>
  {#if reading.unread !== null}
    <p class="px-3 py-2 text-ui text-muted-foreground">{reading.unread}</p>
  {:else if state === null}
    <div class="grid gap-2 p-3" aria-busy="true">
      {#each [48, 76, 62] as width, index (index)}
        <span class="block h-2 animate-pulse rounded-sm bg-selected" style:width="{width}%"></span>
      {/each}
    </div>
  {:else}
    <div class="flex min-w-0 items-center gap-2 px-3 pt-1 pb-1.5 text-small text-muted-foreground" data-base-lens-head>
      <span class="min-w-0 truncate">
        vs <span class="text-foreground/85">{baseName(row)}</span>{#if compared !== null}{' '}@
          <span class="font-mono">{compared.mergeBase.slice(0, SHORT_SHA)}</span>{/if}
      </span>
      {#if (facts?.ahead ?? 0) > 0}<span class="shrink-0 font-mono tabular-nums">↑{facts?.ahead}</span>{/if}
      {#if (facts?.behind ?? 0) > 0}<span class="shrink-0 font-mono tabular-nums text-status-stale">↓{facts?.behind}</span>{/if}
      {#if facts !== null && facts.stateFact.state !== 'current'}<FactStamp fact={facts.stateFact} head={row.head} />{/if}
      {#if compared !== null}
        <LineCount lines={{ added: compared.added, removed: compared.removed }} class="ml-auto shrink-0" />
      {/if}
    </div>
    {#if state.unresolvedBase !== null}
      <p class="px-3 py-1 text-small text-destructive">{state.unresolvedBase} — no such revision here</p>
    {/if}
    {#if nothing}
      <p class="px-3 py-2 text-ui text-muted-foreground" data-base-lens-empty>Nothing differs from {baseName(row)}</p>
    {/if}
    {#if committed.length > 0}
      <ChangeSection fold="base-committed" title="Committed on {row.branch ?? row.name}" count={committed.length}>
        <ChangeList
          items={committed}
          {grouped}
          {selected}
          onOpen={(entry) => onOpen(entry.path, compared === null ? null : { base: compared.mergeBase, head: compared.head }, entry.lines)}
        />
        {#if graphCount > 0}
          <p class="py-1 pr-2 text-small text-muted-foreground/70" style:padding-left="{insetOf(0)}px">
            and {graphCount} graph {graphCount === 1 ? 'file' : 'files'}
          </p>
        {/if}
      </ChangeSection>
    {/if}
    {#if conflicts.length > 0}
      <ChangeSection fold="base-conflicts" title="Conflicts" count={conflicts.length}>
        <ChangeList items={conflicts} {grouped} {selected} onOpen={(entry) => onOpen(entry.path, null, entry.lines)} />
      </ChangeSection>
    {/if}
    {#each groups as group (group.key)}
      <ChangeSection fold="base-thread:{group.key}" title="Uncommitted · {group.name}" count={group.entries.length}>
        <ChangeList items={group.entries} {grouped} {selected} onOpen={(item) => onOpen(item.path, null, item.lines)} />
      </ChangeSection>
    {/each}
  {/if}
</div>
