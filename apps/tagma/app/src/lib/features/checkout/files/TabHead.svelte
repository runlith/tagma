<script lang="ts">
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import GitBranch from '@lucide/svelte/icons/git-branch';
  import type { Snippet } from 'svelte';
  import FileIcon from '$lib/shared/FileIcon.svelte';
  import PathText from '$lib/shared/PathText.svelte';
  import { cn } from '$lib/shared/utils.js';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';

  let {
    path,
    branch = null,
    onBack,
    onShow,
    children,
  }: {
    path: string;
    branch?: string | null;
    onBack?: (() => void) | undefined;
    onShow?: (() => void) | undefined;
    children?: Snippet;
  } = $props();
</script>

<header class="flex h-8 shrink-0 items-center gap-1.5 border-b pr-1.5 pl-2" data-tab-head>
  {#if onBack !== undefined}
    <Tooltip text="Back">
      <button
        type="button"
        class="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
        aria-label="Back"
        onclick={onBack}
      >
        <ArrowLeft class="size-3.5" />
      </button>
    </Tooltip>
  {/if}
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
