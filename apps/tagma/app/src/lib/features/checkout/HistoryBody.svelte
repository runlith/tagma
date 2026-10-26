<script lang="ts">
  import type { TurnPath } from '@tagma/server/change-record/contract/wire/changes';
  import type { LineEndReason } from '@tagma/server/change-record/contract/wire/threadChanges';
  import type { RootId } from '@tagma/server/workspace/contract/wire/ids';
  import { App } from '@runlith/layer/svelte/App.svelte';
  import { linkTarget } from '$lib/features/opening/linkTarget.js';
  import { Opening } from '$lib/features/opening/Opening.svelte.js';
  import PathText from '$lib/shared/PathText.svelte';
  import FileIcon from '$lib/shared/FileIcon.svelte';
  import ReadingFailed from '$lib/shared/ReadingFailed.svelte';
  import { timeAgo } from '$lib/shared/time.js';
  import { insetOf } from './changeItem.js';
  import ChangeSection from './ChangeSection.svelte';
  import { counted, END_WORDS } from './holdingWords.js';
  import { SHORT_SHA } from './reading.js';
  import { changeLink } from './links.js';
  import { ThreadChanges } from './ThreadChanges.svelte.js';
  import { ThreadHistory } from './ThreadHistory.svelte.js';

  type Fate = 'uncommitted' | 'committed' | 'ended';

  let {
    selected,
  }: {
    selected: { readonly rootId: RootId; readonly path: string; readonly commit: string | null } | null;
  } = $props();

  const history = ThreadHistory.use();
  const changes = ThreadChanges.use();
  const opening = Opening.use();
  const here = App.current();

  const rowLink = (rootId: RootId, path: string, commit: string | null) =>
    changeLink({ projectId: changes.projectOf(rootId), rootId, path, commit }, { thread: changes.threadId });

  $effect(() => history.follow());

  let fate = $state<Fate | null>(null);

  const FATES: readonly { readonly id: Fate; readonly label: string }[] = [
    { id: 'uncommitted', label: 'Uncommitted' },
    { id: 'committed', label: 'Committed' },
    { id: 'ended', label: 'Ended' },
  ];

  const fateOf = (path: TurnPath): Fate =>
    path.state === 'held' || path.state === 'writing' ? 'uncommitted' : path.state === 'committed' ? 'committed' : 'ended';

  const turns = $derived(
    history.turns
      .map((turn) => ({ ...turn, paths: fate === null ? turn.paths : turn.paths.filter((path) => fateOf(path) === fate) }))
      .filter((turn) => turn.paths.length > 0),
  );

  const isEnd = (reason: string | null): reason is LineEndReason => reason !== null && reason in END_WORDS;

  function wordOf(path: TurnPath): string {
    switch (path.state) {
      case 'writing':
        return 'Writing';
      case 'held':
        return 'Uncommitted';
      case 'cleared':
        return 'No longer held';
      case 'committed':
        return path.commit === null ? 'Committed' : path.commit.slice(0, SHORT_SHA);
      case 'withdrawn':
        return isEnd(path.reason) ? END_WORDS[path.reason] : (path.reason ?? 'Ended');
    }
  }

  const DOT: Record<Fate, string> = {
    uncommitted: 'bg-status-in-work',
    committed: 'bg-status-done',
    ended: 'bg-status-none',
  };

  const commitOf = (path: TurnPath): string | null | undefined =>
    path.state === 'committed' ? path.commit : path.state === 'held' || path.state === 'writing' ? null : undefined;

  const isSelected = (path: TurnPath): boolean =>
    selected !== null && selected.rootId === path.checkout && selected.path === path.path && selected.commit === (commitOf(path) ?? null);
</script>

{#snippet face(path: TurnPath)}
  <FileIcon path={path.path} />
  <PathText path={path.path} directory="after" class="flex-1" directoryClass="text-small text-muted-foreground/55" />
{/snippet}

{#snippet row(path: TurnPath)}
  {@const commit = commitOf(path)}
  {@const shown = isSelected(path)}
  <div
    class={[
      'relative flex h-6 min-w-0 items-center gap-1.5 rounded-md pr-2 text-ui transition-colors',
      shown ? 'bg-selected text-foreground' : commit === undefined ? 'text-foreground/60' : 'text-foreground/90 hover:bg-hover',
    ]}
    data-history-path={path.path}
    data-history-state={path.state}
  >
    {#if commit === undefined}
      <span class="flex h-6 min-w-0 flex-1 items-center gap-1.5" style:padding-left="{insetOf(1)}px">{@render face(path)}</span>
    {:else}
      <button
        type="button"
        class="flex h-6 min-w-0 flex-1 items-center gap-1.5 text-left outline-none after:absolute after:inset-0 after:rounded-md focus-visible:after:inset-ring-1 focus-visible:after:inset-ring-ring"
        style:padding-left="{insetOf(1)}px"
        aria-current={shown ? 'true' : undefined}
        data-change-path={path.path}
        {@attach linkTarget(opening, () => rowLink(path.checkout as RootId, path.path, commit), here)}
      >
        {@render face(path)}
      </button>
    {/if}
    <span class="flex shrink-0 items-center gap-1 text-meta text-muted-foreground">
      <span class={['size-1.5 rounded-full', DOT[fateOf(path)]]} aria-hidden="true"></span>
      <span class={path.state === 'committed' ? 'font-mono text-foreground/80' : ''}>{wordOf(path)}</span>
    </span>
  </div>
{/snippet}

<div class="flex flex-wrap gap-1 px-3 pt-1 pb-2" role="group" aria-label="Show files that are">
  {#each FATES as one (one.id)}
    <button
      type="button"
      aria-pressed={fate === one.id}
      class={[
        'flex h-5 items-center gap-1 rounded-sm px-1.5 text-small transition-colors',
        fate === one.id ? 'bg-selected text-foreground' : 'bg-hover text-muted-foreground hover:text-foreground',
      ]}
      onclick={() => (fate = fate === one.id ? null : one.id)}
    >
      <span class={['size-1.5 rounded-full', DOT[one.id]]} aria-hidden="true"></span>
      {one.label}
    </button>
  {/each}
</div>

{#if history.reading._tag === 'failed' && history.paths.length === 0}
  <div class="px-3 py-1">
    <ReadingFailed failure={history.reading.refusal} title="The history could not be read" onRetry={() => history.retry()} />
  </div>
{:else if history.reading._tag === 'reading' && history.paths.length === 0}
  <p class="px-3 py-2 text-ui text-muted-foreground">Reading the history…</p>
{:else if history.paths.length === 0}
  <p class="px-3 py-2 text-ui text-muted-foreground" data-history-empty>This thread has changed no files yet</p>
{:else if turns.length === 0}
  <p class="px-3 py-2 text-ui text-muted-foreground">No loaded file matches</p>
{:else}
  {#each turns as turn, at (`${turn.runId ?? 'none'}:${turn.at}:${at}`)}
    <ChangeSection
      fold={`history-${turn.runId ?? turn.at}`}
      title={timeAgo(new Date(turn.at).toISOString())}
      count={counted(turn.paths.length, 'file', 'files')}
    >
      {#each turn.paths as path (`${path.checkout}:${path.path}`)}
        {@render row(path)}
      {/each}
    </ChangeSection>
  {/each}
{/if}

{#if history.more}
  <button
    type="button"
    class="ml-1 flex h-6 items-center rounded-md text-left text-small text-muted-foreground/70 transition-colors hover:bg-hover hover:text-foreground"
    style:padding-left="{insetOf(0)}px"
    onclick={() => history.showMore()}
  >
    Show more · {history.paths.length} of {history.total}
  </button>
{/if}
