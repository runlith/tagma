<script lang="ts">
  import Folder from '@lucide/svelte/icons/folder';
  import FolderOpen from '@lucide/svelte/icons/folder-open';
  import type { FolderFrame } from '@tagma/server/checkout-files/contract/wire/scratch';
  import { App } from '@runlith/layer/svelte/App.svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { linkTarget } from '$lib/features/opening/linkTarget.js';
  import { Opening } from '$lib/features/opening/Opening.svelte.js';
  import FadeText from '$lib/shared/FadeText.svelte';
  import FileIcon from '$lib/shared/FileIcon.svelte';
  import { formatBytes } from '$lib/shared/figures.js';
  import { timeCompact } from '$lib/shared/time.js';
  import { cn } from '$lib/shared/utils.js';
  import { insetOf } from './changeItem.js';
  import { changeLink } from './links.js';
  import { entryPath } from './ScratchFolder.svelte.js';
  import ScratchNested from './ScratchNested.svelte';
  import { ThreadChanges } from './ThreadChanges.svelte.js';

  let { frame, projectId, thread, path, depth }: { frame: FolderFrame; projectId: number; thread: string; path: string; depth: number } =
    $props();

  const opening = Opening.use();
  const changes = ThreadChanges.use();
  const here = App.current();
  const expanded = new SvelteSet<string>();

  const hidden = $derived(frame.total - frame.entries.length);
  const shown = $derived(changes.open?.rootId === null ? changes.open.path : null);

  const absolute = (name: string): string => `${frame.directory}/${name}`;

  const opens = (name: string) =>
    linkTarget(opening, () => changeLink({ projectId, rootId: null, path: absolute(name), commit: null }, { thread }), here);

  const when = (at: number): string => timeCompact(new Date(at).toISOString());
</script>

{#each frame.entries as entry (entry.name)}
  {@const selected = entry.kind === 'file' && shown === absolute(entry.name)}
  <div
    class={cn(
      'group/row relative flex h-6 min-w-0 items-center gap-1.5 rounded-md pr-2 text-ui transition-colors',
      selected ? 'bg-selected text-foreground' : 'text-foreground/90 hover:bg-hover',
    )}
  >
    {#if entry.kind === 'directory'}
      {@const open = expanded.has(entry.name)}
      <button
        type="button"
        class="flex h-6 min-w-0 flex-1 items-center gap-1.5 text-left outline-none after:absolute after:inset-0 after:rounded-md focus-visible:after:inset-ring-1 focus-visible:after:inset-ring-ring"
        style:padding-left="{insetOf(depth)}px"
        aria-expanded={open}
        data-scratch-folder={entry.name}
        onclick={() => (open ? expanded.delete(entry.name) : expanded.add(entry.name))}
      >
        {#if open}
          <FolderOpen class="size-3.5 shrink-0 text-muted-foreground/70" />
        {:else}
          <Folder class="size-3.5 shrink-0 text-muted-foreground/70" />
        {/if}
        <FadeText class="flex-1" text={entry.name} />
      </button>
    {:else}
      <button
        type="button"
        class="flex h-6 min-w-0 flex-1 items-center gap-1.5 text-left outline-none after:absolute after:inset-0 after:rounded-md focus-visible:after:inset-ring-1 focus-visible:after:inset-ring-ring"
        style:padding-left="{insetOf(depth)}px"
        aria-current={selected ? 'true' : undefined}
        data-change-path={entryPath(path, entry.name)}
        {@attach opens(entry.name)}
      >
        <FileIcon path={entry.name} />
        <FadeText class="flex-1" text={entry.name} />
      </button>
      <span class="shrink-0 text-meta tabular-nums text-muted-foreground/60">{formatBytes(entry.bytes)}</span>
    {/if}
    <span class="w-8 shrink-0 text-right text-meta tabular-nums text-muted-foreground/50">{when(entry.modifiedAt)}</span>
  </div>
  {#if entry.kind === 'directory' && expanded.has(entry.name)}
    <ScratchNested {projectId} {thread} path={entryPath(path, entry.name)} depth={depth + 1} />
  {/if}
{/each}
{#if hidden > 0}
  <p class="py-0.5 pr-2 text-small text-muted-foreground/60" style:padding-left="{insetOf(depth)}px" data-scratch-hidden={hidden}>
    {hidden} older not shown
  </p>
{/if}
