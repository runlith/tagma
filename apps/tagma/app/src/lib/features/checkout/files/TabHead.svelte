<script lang="ts">
  import GitBranch from '@lucide/svelte/icons/git-branch';
  import type { Snippet } from 'svelte';
  import FileIcon from '$lib/shared/FileIcon.svelte';
  import PathText from '$lib/shared/PathText.svelte';
  import { cn } from '$lib/shared/utils.js';

  let {
    path,
    branch = null,
    onShow,
    children,
  }: {
    path: string;
    branch?: string | null;
    onShow?: (() => void) | undefined;
    children?: Snippet;
  } = $props();
</script>

<header class="flex h-8 shrink-0 items-center gap-1.5 border-b pr-1.5 pl-2" data-tab-head>
  <FileIcon {path} class="ml-1" />
  <PathText
    {path}
    directory="after"
    class="flex-1 text-ui"
    nameClass="font-medium"
    directoryClass={cn(
      'text-small text-muted-foreground/55',
      onShow !== undefined &&
        'underline decoration-transparent underline-offset-3 transition-colors hover:text-muted-foreground hover:decoration-border',
    )}
    onDirectory={onShow}
    directoryTitle="Show in Files"
  />
  {#if branch !== null}
    <span class="flex shrink-0 items-center gap-1 rounded-sm bg-hover px-1.5 py-0.5 text-meta text-muted-foreground" data-tab-branch>
      <GitBranch class="size-3" />{branch}
    </span>
  {/if}
  {#if children !== undefined}
    <span class="ml-1 flex shrink-0 items-center gap-px">{@render children()}</span>
  {/if}
</header>
