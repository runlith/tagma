<script lang="ts">
  import type { CheckoutLines, ComparedPath } from '@tagma/server/workspace/contract/wire/checkout';
  import type { ChangeCommit } from '@tagma/server/change-record/contract/wire/threadChanges';
  import type { RootId } from '@tagma/server/workspace/contract/wire/ids';
  import { App } from '@runlith/layer/svelte/App.svelte';
  import { carriedLink, linkTarget } from '$lib/features/opening/linkTarget.js';
  import { Opening } from '$lib/features/opening/Opening.svelte.js';
  import FadeText from '$lib/shared/FadeText.svelte';
  import { ReaderMarks } from '$lib/shared/reading/ReaderMarks.svelte.js';
  import { changeLink } from './links.js';
  import ChangesBody from './ChangesBody.svelte';
  import ChangeSection from './ChangeSection.svelte';
  import { insetOf } from './changeItem.js';
  import { sameLines } from './lineCount.js';
  import type { ChangesLens, CommitRange } from './opened.js';
  import CommitList from './CommitList.svelte';
  import GroupingToggle from './GroupingToggle.svelte';
  import HistoryBody from './HistoryBody.svelte';
  import { groupedIn } from './grouping.js';
  import CheckoutName from './CheckoutName.svelte';
  import { abroad } from './checkoutName.js';
  import { ThreadChanges } from './ThreadChanges.svelte.js';
  import ViewMenu from './ViewMenu.svelte';
  import BaseLens from './BaseLens.svelte';
  import { ThreadRung } from '$lib/features/workspace/ThreadRung.js';
  import { baseName } from '$lib/features/worktrees/BaseReading.svelte.js';
  import FinishStrip from '$lib/features/worktrees/FinishStrip.svelte';
  import { Worktrees } from '$lib/features/worktrees/BoardState.svelte.js';

  const changes = ThreadChanges.use();
  const opening = Opening.use();
  const here = App.current();
  const marks = ReaderMarks.use();
  const worktrees = Worktrees.use();
  const threadId = ThreadRung.Current.use().id;
  const place = $derived(worktrees.placeOf(threadId));
  const outside = $derived(place !== null && place.kind === 'tagma' && place.base !== null ? place : null);
  const lensShown = $derived<ChangesLens>(outside === null && changes.lens === 'base' ? 'now' : changes.lens);
  const lenses = $derived<readonly { readonly id: ChangesLens; readonly label: string; readonly count?: number }[]>([
    { id: 'now', label: 'Now', count: changes.held?.paths ?? 0 },
    { id: 'history', label: 'History' },
    ...(outside === null ? [] : [{ id: 'base' as const, label: `vs ${baseName(outside)}` }]),
  ]);

  function aimLens(next: ChangesLens): void {
    if (next === changes.lens) return;
    changes.lens = next;
    if (next !== 'base' && changes.open?.lens !== undefined) changes.open = null;
  }

  function showInLens(path: string, range: CommitRange | null, lines: CheckoutLines): void {
    if (outside === null) return;
    const open = changes.open;
    const same =
      open?.path === path &&
      open.commit === null &&
      open.lens !== undefined &&
      open.lens.range?.base === range?.base &&
      open.lens.range?.head === range?.head;
    changes.open = same ? null : { projectId: worktrees.aim.projectId, rootId: outside.rootId, path, commit: null, lens: { range }, lines };
  }

  function countedInLens(lines: CheckoutLines): void {
    const open = changes.open;
    if (open?.lens === undefined || sameLines(open.lines, lines)) return;
    changes.open = { ...open, lines };
  }

  const grouped = $derived(groupedIn(marks));

  const commits = $derived.by(() => {
    const by = new Map<RootId, ChangeCommit[]>();
    for (const commit of changes.commits) by.set(commit.checkout, [...(by.get(commit.checkout) ?? []), commit]);
    return [...by].map(([rootId, listed]) => ({ rootId, place: changes.checkoutOf(rootId), commits: listed }));
  });
  const commitsAbroad = $derived(abroad(changes.commits, changes.projectId));

  const working = $derived(changes.open?.commit === null && changes.open.lens === undefined ? changes.open : null);
  const inCommit = $derived(
    changes.open === null || changes.open.commit === null
      ? null
      : { rootId: changes.open.rootId, commit: changes.open.commit, path: changes.open.path },
  );

  let list = $state<HTMLElement | null>(null);

  const commitLink = (rootId: RootId) => (commit: string, file: ComparedPath) =>
    linkTarget(
      opening,
      () => changeLink({ projectId: changes.projectOf(rootId), rootId, path: file.path, commit }, { thread: changes.threadId }),
      here,
    );

  function walk(event: KeyboardEvent): void {
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    const target = event.target;
    if (step === 0 || event.defaultPrevented || !(target instanceof HTMLElement) || target.dataset.changePath === undefined) {
      return;
    }
    const rows = [...(list?.querySelectorAll<HTMLButtonElement>('button[data-change-path]') ?? [])];
    const next = rows[rows.indexOf(target as HTMLButtonElement) + step];
    if (next === undefined) return;
    event.preventDefault();
    if (next.getAttribute('aria-current') !== 'true') {
      const link = carriedLink(next);
      if (link === null) next.click();
      else void opening.open(link, 'beside', here);
    }
    next.focus();
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section
  bind:this={list}
  class="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-chrome outline-none"
  tabindex="-1"
  aria-label="Changes"
  onkeydown={walk}
  data-files-column
>
  <header class="flex h-8 shrink-0 items-center gap-0.5 border-b pr-1.5 pl-2">
    <div class="flex min-w-0 gap-0.5 rounded-md bg-hover p-0.5" role="group" aria-label="Changes lens" data-changes-lens={lensShown}>
      {#each lenses as choice (choice.id)}
        <button
          type="button"
          aria-pressed={lensShown === choice.id}
          class={[
            'flex h-5 min-w-0 items-center gap-1 rounded-sm px-1.5 text-small transition-colors',
            lensShown === choice.id ? 'bg-selected font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
          ]}
          onclick={() => aimLens(choice.id)}
        >
          <FadeText text={choice.label} />
          {#if choice.count !== undefined && choice.count > 0}
            <span class="shrink-0 font-normal tabular-nums text-muted-foreground">{choice.count}</span>
          {/if}
        </button>
      {/each}
    </div>
    <span class="flex-1"></span>
    {#if lensShown !== 'history'}<GroupingToggle />{/if}
    <ViewMenu />
  </header>

  <div class="min-h-0 flex-1 overflow-y-auto py-1">
    {#if lensShown === 'history'}
      {#if commits.length > 0}
        <ChangeSection
          fold="thread-commits"
          title="Commits"
          count={changes.moreCommits ? `${changes.commits.length}+` : changes.commits.length}
        >
          {#each commits as group (group.rootId)}
            {#if commits.length > 1 || commitsAbroad}
              <p class="flex h-6 min-w-0 items-center pr-2 text-small text-muted-foreground/75" style:padding-left="{insetOf(0)}px">
                {#if group.place === null}
                  <FadeText text={group.rootId.slice(0, 8)} />
                {:else}
                  <CheckoutName checkout={group.place} project={commitsAbroad} />
                {/if}
              </p>
            {/if}
            <CommitList
              projectId={changes.projectOf(group.rootId)}
              rootId={group.rootId}
              commits={group.commits}
              thread={changes.threadId}
              {grouped}
              selected={inCommit?.rootId === group.rootId ? inCommit : null}
              open={changes.expandedCommits}
              gitLink
              link={commitLink(group.rootId)}
            />
          {/each}
          {#if changes.moreCommits}
            <button
              type="button"
              class="flex h-6 items-center rounded-md text-left text-small text-muted-foreground/70 transition-colors hover:bg-hover hover:text-foreground"
              style:padding-left="{insetOf(0)}px"
              onclick={() => changes.showMoreCommits()}
            >
              Show more
            </button>
          {/if}
        </ChangeSection>
      {/if}
      <HistoryBody selected={changes.open === null || changes.open.lens !== undefined ? null : changes.open} />
    {:else if lensShown === 'base' && outside !== null}
      <BaseLens
        row={outside}
        projectId={worktrees.aim.projectId}
        selected={changes.open?.lens !== undefined && changes.open.commit === null ? changes.open.path : null}
        onOpen={showInLens}
        onCounts={countedInLens}
      />
    {:else}
      <ChangesBody {grouped} selected={working} />
    {/if}
  </div>

  {#if outside !== null}
    <FinishStrip row={outside} />
  {/if}
</section>
