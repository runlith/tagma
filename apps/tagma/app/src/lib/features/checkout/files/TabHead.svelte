<script lang="ts">
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import GitBranch from '@lucide/svelte/icons/git-branch';
  import X from '@lucide/svelte/icons/x';
  import type { Snippet } from 'svelte';
  import FileIcon from '$lib/shared/FileIcon.svelte';
  import PathText from '$lib/shared/PathText.svelte';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import { cn } from '$lib/shared/utils.js';

  let {
    path,
    branch = null,
    onShow,
    onBack,
    onClose,
    children,
  }: {
    path: string;
    branch?: string | null;
    onShow?: (() => void) | undefined;
    onBack?: (() => void) | undefined;
    onClose?: (() => void) | undefined;
    children?: Snippet;
  } = $props();

  const ICON =
    'grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground';
</script>

<header class="flex h-8 shrink-0 items-center gap-1.5 border-b pr-1.5 pl-2" data-tab-head>
  {#if onBack !== undefined}
    <Tooltip text="Back">
      <button type="button" class={ICON} aria-label="Back" onclick={onBack}><ArrowLeft class="size-3.5" /></button>
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
  {#if children !== undefined || onClose !== undefined}
    <span class="ml-1 flex shrink-0 items-center gap-px">
      {@render children?.()}
      {#if onClose !== undefined}
        <Tooltip text="Close">
          <button type="button" class={ICON} aria-label="Close" onclick={onClose}><X class="size-3.5" /></button>
        </Tooltip>
      {/if}
    </span>
  {/if}
</header>
