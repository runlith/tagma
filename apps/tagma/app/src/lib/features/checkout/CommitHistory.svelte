<script lang="ts">
  import type { RootId } from '@tagma/server/workspace/contract/wire/ids';
  import { Notices } from '$lib/features/notices/Service.svelte.js';
  import { timeAgo } from '$lib/shared/time.js';
  import { CheckoutRepo } from './Repo.js';
  import { PathCommits } from './PathCommits.svelte.js';

  let { projectId, rootId, path, onPick }: { projectId: number; rootId: RootId; path: string; onPick: (commit: string) => void } = $props();

  const notices = Notices.use();
  const commits = new PathCommits(CheckoutRepo.use(), () => ({ projectId, rootId, path }));

  let box = $state<HTMLElement | null>(null);

  $effect(() => {
    if (box === null) return;
    const line = Number.parseFloat(getComputedStyle(box).lineHeight);
    if (!Number.isFinite(line) || line <= 0) return;
    commits.measured(Math.floor(box.clientHeight / line) + 1);
  });

  $effect(() => {
    if (commits.failed !== undefined) notices.refusal(commits.failed);
  });
</script>

<div bind:this={box} class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2 py-1.5 text-ui leading-7" data-path-history={path}>
  {#if commits.lines === null}
    <div class="grid gap-2 p-2" aria-busy="true">
      {#each [64, 52, 70] as width, index (index)}
        <span class="block h-2 animate-pulse rounded-sm bg-selected" style:width="{width}%"></span>
      {/each}
    </div>
  {:else if commits.lines.length === 0}
    <p class="px-2 text-muted-foreground">No commits touch this file yet</p>
  {:else}
    <ol class="grid grid-cols-1">
      {#each commits.lines as line (line.full)}
        <li>
          <button
            type="button"
            class="flex h-7 w-full min-w-0 items-center gap-3 rounded-md px-2 text-left transition-colors hover:bg-hover"
            onclick={() => onPick(line.full)}
            data-history-commit={line.sha}
          >
            <span class="shrink-0 font-mono text-meta text-muted-foreground/60">{line.sha}</span>
            <span class="min-w-0 flex-1 truncate">{line.subject}</span>
            <span class="shrink-0 truncate text-small text-muted-foreground/60">{line.author}</span>
            <span class="shrink-0 text-meta tabular-nums text-muted-foreground/60">{timeAgo(line.date)}</span>
          </button>
        </li>
      {/each}
      {#if commits.more}
        <li>
          <button
            type="button"
            class="h-7 w-full rounded-md px-2 text-left text-muted-foreground/70 transition-colors hover:bg-hover hover:text-foreground"
            onclick={() => commits.askMore()}
            data-history-more
          >
            Show more
          </button>
        </li>
      {/if}
    </ol>
  {/if}
</div>
