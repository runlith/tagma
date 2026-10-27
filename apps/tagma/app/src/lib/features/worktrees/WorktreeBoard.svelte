<script lang="ts">
  import Eraser from '@lucide/svelte/icons/eraser';
  import Plus from '@lucide/svelte/icons/plus';
  import type { WorktreePlace } from '@tagma/server/worktrees/contract/wire/rows';
  import { WallClock } from '$lib/features/workspace/WallClock.svelte.js';
  import PageHeader from '$lib/shared/PageHeader.svelte';
  import ReadingFailed from '$lib/shared/ReadingFailed.svelte';
  import { Button } from '$lib/shared/ui/button/index.js';
  import { GROUPS, groupOf, type Group } from './board.js';
  import BoardRow from './BoardRow.svelte';
  import { Cleanup } from './Cleanup.svelte.js';
  import { Finishing } from './Finishing.svelte.js';
  import { counted } from './finishWords.js';
  import NewWorktreeDialog from './NewWorktreeDialog.svelte';
  import OutcomeLine from './OutcomeLine.svelte';
  import { Worktrees } from './BoardState.svelte.js';

  type Layout = readonly { readonly group: Group; readonly ids: readonly string[] }[];

  const worktrees = Worktrees.use();
  const reading = worktrees.window();
  const finishing = Finishing.use();
  const cleanup = Cleanup.use();
  const clock = WallClock.use();
  const unread = $derived(reading.unread ?? worktrees.unread);

  $effect(() => clock.watchMinutes());

  const listed = $derived(worktrees.rows.filter((row) => row.kind !== 'external' || row.branch !== null || row.agents.standing > 0));
  const main = $derived(listed.find((row) => row.kind === 'main') ?? null);

  const byMovement = (left: WorktreePlace, right: WorktreePlace): number =>
    (right.movedAt ?? '').localeCompare(left.movedAt ?? '') || left.index - right.index;

  const live = $derived.by<Layout>(() => {
    const grouped = new Map<Group, string[]>();
    for (const row of listed.filter((one) => one.kind !== 'main').sort(byMovement)) {
      const group = groupOf(row, reading.rowOf(row.rootId), finishing.inFlight(row.rootId) !== null);
      const bucket = grouped.get(group);
      if (bucket === undefined) grouped.set(group, [row.rootId]);
      else bucket.push(row.rootId);
    }
    return GROUPS.flatMap(({ id }) => {
      const ids = grouped.get(id);
      return ids === undefined ? [] : [{ group: id, ids }];
    });
  });

  let held = $state.raw<Layout | null>(null);
  let pointed = false;
  let menus = 0;
  const layout = $derived(held ?? live);

  function hold(): void {
    held ??= live;
  }

  function release(): void {
    if (!pointed && menus === 0) held = null;
  }

  function menu(open: boolean): void {
    menus += open ? 1 : -1;
    if (open) hold();
    else release();
  }

  const total = $derived(live.reduce((sum, one) => sum + one.ids.length, 0));
  const needs = $derived(live.find((one) => one.group === 'needs')?.ids.length ?? 0);
  const wordsOf = (group: Group): string => GROUPS.find((one) => one.id === group)?.words ?? group;

  let creating = $state(false);
</script>

<div class="h-full min-h-0 overflow-auto" data-worktree-board>
  <div class="page-wide pt-8 pb-16">
    <PageHeader title="Worktrees" class="mb-5">
      {#snippet caption()}
        {#if total === 0}
          Only the project checkout
        {:else}
          {counted(total, 'worktree')}{#if needs > 0},
            <span class="font-medium text-foreground">{needs} {needs === 1 ? 'needs' : 'need'} you</span>{/if}
        {/if}
      {/snippet}
      {#snippet actions()}
        <Button size="sm" variant="outline" onclick={() => (creating = true)}>
          <Plus class="size-3.5" />
          New worktree
        </Button>
      {/snippet}
    </PageHeader>

    {#if unread !== null}
      <div class="mb-4"><ReadingFailed failure={unread} title="The worktree list stopped updating; rows show how they last stood" /></div>
    {/if}

    {#if main !== null}
      <BoardRow
        row={main}
        facts={reading.rowOf(main.rootId)}
        observe={reading.observe(main.rootId)}
        here={worktrees.aimed?.rootId === main.rootId}
        onMenu={menu}
      />
      <div class="mx-3 mt-2 border-b"></div>
    {/if}

    <div
      role="presentation"
      data-board-list
      onpointerenter={() => {
        pointed = true;
        hold();
      }}
      onpointerleave={() => {
        pointed = false;
        release();
      }}
    >
      {#each layout as section (section.group)}
        <section class="pt-4" data-board-group={section.group}>
          <h2 class="flex h-7 items-center gap-2 px-3 text-small font-medium text-muted-foreground">
            {wordsOf(section.group)}
            <span class="tabular text-muted-foreground/70">{section.ids.length}</span>
            {#if section.group === 'clean'}
              <span class="flex-1"></span>
              <Button size="xs" variant="quiet" onclick={() => cleanup.show()} data-board-cleanup>
                <Eraser class="size-3" />
                Clean up…
              </Button>
            {/if}
          </h2>
          {#each section.ids as rootId (rootId)}
            {@const row = worktrees.byRoot(rootId)}
            {#if row !== null}
              <BoardRow
                {row}
                facts={reading.rowOf(rootId)}
                observe={reading.observe(rootId)}
                here={worktrees.aimed?.rootId === rootId}
                onMenu={menu}
              />
            {/if}
          {/each}
        </section>
      {/each}
    </div>

    {#if finishing.departed.length > 0}
      <div class="mt-4 grid gap-1.5 px-3" data-board-departed>
        {#each finishing.departed as outcome (outcome.id)}
          <OutcomeLine {outcome} named class="text-small" />
        {/each}
      </div>
    {/if}
  </div>
</div>

<NewWorktreeDialog bind:open={creating} from={worktrees.aimed?.branch ?? null} />
