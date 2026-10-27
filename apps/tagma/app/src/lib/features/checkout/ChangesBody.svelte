<script lang="ts">
  import Users from '@lucide/svelte/icons/users';
  import type { ThreadCheckout, ThreadEntry } from '@tagma/server/change-record/contract/wire/threadChanges';
  import type { RootId } from '@tagma/server/workspace/contract/wire/ids';
  import { App } from '@runlith/layer/svelte/App.svelte';
  import { linkTarget } from '$lib/features/opening/linkTarget.js';
  import { Opening } from '$lib/features/opening/Opening.svelte.js';
  import FadeText from '$lib/shared/FadeText.svelte';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import { ThreadNames } from '$lib/shared/threads/Names.svelte.js';
  import type { LineCounts } from '@tagma/server/change-record/contract/wire/holdings';
  import ChangeList from './ChangeList.svelte';
  import ChangeSection from './ChangeSection.svelte';
  import { type ChangeItem, insetOf } from './changeItem.js';
  import CheckoutName from './CheckoutName.svelte';
  import { abroad } from './checkoutName.js';
  import LineCount from './LineCount.svelte';
  import { changeLink } from './links.js';
  import { holderName } from '$lib/features/worktrees/holders.js';
  import { unprovenWords } from './holdingWords.js';
  import ScratchSection from './ScratchSection.svelte';
  import { entriesIn, type EntryIn, type Section, ThreadChanges } from './ThreadChanges.svelte.js';

  let {
    grouped,
    selected,
  }: {
    grouped: boolean;
    selected: { readonly rootId: RootId; readonly path: string } | null;
  } = $props();

  const changes = ThreadChanges.use();
  const names = ThreadNames.use();
  const opening = Opening.use();
  const here = App.current();

  const rowLink = (rootId: RootId) => (item: ChangeItem) =>
    linkTarget(
      opening,
      () => changeLink({ projectId: changes.projectOf(rootId), rootId, path: item.path, commit: null }, { thread: changes.threadId }),
      here,
    );

  type Item<S extends Section> = ChangeItem & { readonly entry: EntryIn<S> };

  type Group<S extends Section> = { readonly checkout: ThreadCheckout; readonly items: readonly Item<S>[] };

  const faceOf = (entry: ThreadEntry): ChangeItem => ({
    path: entry.path,
    status: entry.section === 'outside' || entry.git === 'ignored' ? null : entry.git,
    lines: entry.section === 'unproven' ? 'unweighed' : entry.lines,
  });

  function groupsOf<S extends Section>(section: S): readonly Group<S>[] {
    return changes.checkouts
      .map((checkout) => ({
        checkout,
        items: entriesIn(checkout, section)
          .map((entry) => ({ ...faceOf(entry), entry }))
          .sort((one, two) => one.path.localeCompare(two.path)),
      }))
      .filter((group) => group.items.length > 0);
  }

  const uncommitted = $derived(groupsOf('uncommitted'));
  const unproven = $derived(groupsOf('unproven'));
  const outside = $derived(groupsOf('outside'));
  const sizeOf = (groups: readonly { readonly items: readonly unknown[] }[]): number =>
    groups.reduce((sum, group) => sum + group.items.length, 0);
  const placed = (groups: readonly { readonly checkout: ThreadCheckout }[]): boolean =>
    abroad(
      groups.map((group) => group.checkout),
      changes.projectId,
    );
  const uncommittedAbroad = $derived(placed(uncommitted));
  const unprovenAbroad = $derived(placed(unproven));
  const outsideAbroad = $derived(placed(outside));
  const staleAbroad = $derived(abroad(changes.checkouts, changes.projectId));

  const stale = $derived(changes.checkouts.filter((checkout) => checkout.state.kind === 'stale'));
  const judged = $derived(changes.checkouts.every((checkout) => checkout.state.kind === 'current' || checkout.state.kind === 'judging'));
  const listed = $derived(sizeOf(uncommitted) + sizeOf(unproven) + sizeOf(outside));

  const selectedIn = (checkout: ThreadCheckout): string | null =>
    selected !== null && selected.rootId === checkout.checkout ? selected.path : null;

  const othersSaid = (entry: EntryIn<'uncommitted'>): string =>
    [
      ...(entry.others.length === 0
        ? []
        : [
            `Also held by ${entry.others.map((other) => holderName(other.holder, (thread) => names.of(thread)?.label ?? null)).join(', ')}`,
          ]),
      ...(entry.nobody ? ['some lines here are nobody’s'] : []),
    ].join(' · ');

  function reasonsOf(
    items: readonly Item<'unproven'>[],
  ): readonly { readonly said: string; readonly items: readonly Item<'unproven'>[] }[] {
    const by = new Map<string, Item<'unproven'>[]>();
    for (const item of items) {
      const said = unprovenWords(item.entry.reason);
      by.set(said, [...(by.get(said) ?? []), item]);
    }
    return [...by].map(([said, held]) => ({ said, items: held }));
  }
</script>

{#snippet others(item: Item<'uncommitted'>)}
  {#if item.entry.others.length > 0 || item.entry.nobody}
    <Tooltip text={othersSaid(item.entry)}>
      <span
        class="flex shrink-0 items-center gap-0.5 text-meta tabular-nums text-muted-foreground/70"
        data-change-others={item.entry.others.length}
      >
        <Users class="size-3" />{item.entry.others.length > 0 ? item.entry.others.length : ''}{item.entry.nobody ? '?' : ''}
      </span>
    </Tooltip>
  {/if}
{/snippet}

{#snippet heading(checkout: ThreadCheckout, shown: boolean, project: boolean, lines?: LineCounts)}
  {#if shown}
    <p
      class="flex h-6 min-w-0 items-center gap-1.5 pr-2 text-small text-muted-foreground/75"
      style:padding-left="{insetOf(0)}px"
      data-change-checkout={checkout.checkout}
    >
      <CheckoutName {checkout} {project} class="flex-1" />
      {#if lines !== undefined}
        <LineCount {lines} class="shrink-0" />
        <span class="w-3 shrink-0"></span>
      {/if}
    </p>
  {/if}
{/snippet}

{#if changes.known}
  {#each stale as checkout (checkout.checkout)}
    {#if checkout.state.kind === 'stale'}
      <div
        class="mx-2 mb-1 flex min-w-0 items-center gap-2 rounded-md bg-status-stale/12 px-2 py-1 text-small text-status-stale"
        data-files-stale={checkout.checkout}
      >
        {#if changes.checkouts.length > 1 || staleAbroad}
          <CheckoutName {checkout} project={staleAbroad} class="max-w-1/3 shrink-0 font-medium" />
        {/if}
        <FadeText class="flex-1" text={checkout.state.reason} />
        <button type="button" class="shrink-0 rounded-sm px-1 transition-colors hover:bg-hover" onclick={() => changes.retry()}
          >Retry</button
        >
      </div>
    {/if}
  {/each}

  {#if changes.empty}
    <p class="px-3 py-2 text-ui text-muted-foreground" data-files-empty>No changes yet</p>
  {:else}
    {#if listed > 0 || judged}
      <ChangeSection fold="thread-uncommitted" title="Uncommitted" count={sizeOf(uncommitted)} lines={changes.uncommitted}>
        {#if uncommitted.length === 0 && judged}
          <p class="py-1 pr-2 text-small text-muted-foreground/70" style:padding-left="{insetOf(0)}px" data-files-all-committed>
            All changes are committed
          </p>
        {/if}
        {#each uncommitted as group (group.checkout.checkout)}
          {@render heading(group.checkout, uncommitted.length > 1 || uncommittedAbroad, uncommittedAbroad, group.checkout.uncommitted)}
          <ChangeList
            items={group.items}
            {grouped}
            selected={selectedIn(group.checkout)}
            link={rowLink(group.checkout.checkout)}
            aside={others}
          />
        {/each}
      </ChangeSection>
    {/if}

    {#if unproven.length > 0}
      <ChangeSection fold="thread-unproven" title="Unchecked" count={sizeOf(unproven)}>
        {#each unproven as group (group.checkout.checkout)}
          {@render heading(group.checkout, unproven.length > 1 || unprovenAbroad, unprovenAbroad)}
          {#each reasonsOf(group.items) as reason (reason.said)}
            <p class="py-0.5 pr-2 text-small text-muted-foreground/70" style:padding-left="{insetOf(0)}px" data-files-unproven-reason>
              {reason.said}
            </p>
            <ChangeList items={reason.items} {grouped} selected={selectedIn(group.checkout)} link={rowLink(group.checkout.checkout)} />
          {/each}
        {/each}
      </ChangeSection>
    {/if}

    {#if outside.length > 0}
      <ChangeSection fold="thread-outside" title="Outside git" count={sizeOf(outside)}>
        {#each outside as group (group.checkout.checkout)}
          {@render heading(group.checkout, outside.length > 1 || outsideAbroad, outsideAbroad)}
          <ChangeList items={group.items} {grouped} selected={selectedIn(group.checkout)} link={rowLink(group.checkout.checkout)} />
        {/each}
      </ChangeSection>
    {/if}
  {/if}
{/if}

<ScratchSection projectId={changes.projectId} thread={changes.threadId} />
