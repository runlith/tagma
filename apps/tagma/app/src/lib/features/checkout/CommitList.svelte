<script lang="ts">
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import GitCommitVertical from '@lucide/svelte/icons/git-commit-vertical';
  import type { ComparedPath } from '@tagma/server/workspace/contract/wire/checkout';
  import type { RootId } from '@tagma/server/workspace/contract/wire/ids';
  import type { Attachment } from 'svelte/attachments';
  import { SvelteSet } from 'svelte/reactivity';
  import { timeAgo } from '$lib/shared/time.js';
  import { insetOf } from './changeItem.js';
  import CommitFiles from './CommitFiles.svelte';
  import { commitRuns, type CommitEntry } from './commitRuns.js';

  let {
    projectId,
    rootId,
    commits,
    thread,
    grouped,
    selected,
    opened = null,
    open = new SvelteSet<string>(),
    gitLink = false,
    foldGraph = false,
    onOpen,
    onKeep,
    link,
  }: {
    projectId: number;
    rootId: RootId;
    commits: readonly CommitEntry[];
    thread?: string | undefined;
    grouped: boolean;
    selected: { readonly commit: string; readonly path: string } | null;
    opened?: string | null;
    open?: SvelteSet<string>;
    gitLink?: boolean;
    foldGraph?: boolean;
    onOpen?: ((commit: string, file: ComparedPath) => void) | undefined;
    onKeep?: ((commit: string, file: ComparedPath) => void) | undefined;
    link?: ((commit: string, file: ComparedPath) => Attachment<HTMLElement>) | undefined;
  } = $props();

  const unfolded = new SvelteSet<string>();

  $effect(() => {
    if (opened !== null) open.add(opened);
  });

  const runs = $derived(commitRuns(commits, foldGraph));

  function toggle(sha: string): void {
    if (open.has(sha)) open.delete(sha);
    else open.add(sha);
  }
</script>

{#snippet commitRow(commit: CommitEntry)}
  {@const expanded = open.has(commit.sha)}
  <button
    type="button"
    class="flex h-[26px] w-full min-w-0 items-center gap-1.5 rounded-md pr-2 text-left text-ui transition-colors hover:bg-hover"
    style:padding-left="{insetOf(0)}px"
    aria-expanded={expanded}
    onclick={() => toggle(commit.sha)}
    data-commit={commit.sha}
  >
    <ChevronRight class={['size-3.5 shrink-0 text-muted-foreground/60 transition-transform duration-150', expanded && 'rotate-90']} />
    <span class="min-w-0 flex-1 truncate text-foreground/90">{commit.subject}</span>
    {#if commit.files !== undefined}
      <span class="shrink-0 text-meta tabular-nums text-muted-foreground/55">{commit.files} {commit.files === 1 ? 'file' : 'files'}</span>
    {/if}
    <span class="shrink-0 text-meta tabular-nums text-muted-foreground/60">{timeAgo(commit.date)}</span>
  </button>
  {#if expanded}
    <CommitFiles
      {projectId}
      {rootId}
      commit={commit.sha}
      author={commit.author}
      {thread}
      {grouped}
      selected={selected?.commit === commit.sha ? selected.path : null}
      {gitLink}
      onOpen={onOpen === undefined ? undefined : (file) => onOpen(commit.sha, file)}
      onKeep={onKeep === undefined ? undefined : (file) => onKeep(commit.sha, file)}
      link={link === undefined ? undefined : (file) => link(commit.sha, file)}
    />
  {/if}
{/snippet}

<div class="grid min-w-0 gap-px" data-commit-list>
  {#each runs as run (run.key)}
    {#if run.kind === 'commit'}
      {@render commitRow(run.commit)}
    {:else if unfolded.has(run.key)}
      {#each run.commits as commit (commit.sha)}
        {@render commitRow(commit)}
      {/each}
    {:else}
      <button
        type="button"
        class="flex h-[26px] w-full min-w-0 items-center gap-1.5 rounded-md pr-2 text-left text-small text-muted-foreground/60 transition-colors hover:bg-hover hover:text-muted-foreground"
        style:padding-left="{insetOf(0)}px"
        onclick={() => unfolded.add(run.key)}
        data-graph-run={run.commits.length}
      >
        <GitCommitVertical class="size-3.5 shrink-0" />
        <span class="min-w-0 flex-1 truncate">{run.commits.length} graph {run.commits.length === 1 ? 'sync' : 'syncs'}</span>
        <span class="shrink-0 tabular-nums">{timeAgo(run.commits[0]?.date ?? '')}</span>
      </button>
    {/if}
  {/each}
</div>
