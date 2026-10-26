<script lang="ts">
  import Download from '@lucide/svelte/icons/download';
  import type { Download as Kept, Page } from '@tagma/server/browser/contract/wire/page';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import * as Popover from '$lib/shared/ui/popover/index.js';
  import { Door } from '$lib/wire/Door.js';
  import { savedAddress } from './saved.js';

  let { page, touch = false }: { page: Page; touch?: boolean } = $props();

  const door = Door.use();

  let open = $state(false);
  let kept = $state.raw<readonly Kept[]>([]);
  let total = $state(0);
  let problem = $state<string | null>(null);
  let keptFor: string | null = null;

  const id = $derived(page.id);
  const count = $derived(page.downloads);
  const project = $derived(String(page.projectId));

  $effect(() => {
    if (!open) return;
    if (keptFor !== id) {
      keptFor = id;
      kept = [];
      total = 0;
      problem = null;
    }
    let stale = false;
    door
      .perform('read_page_downloads', { page: id, limit: Math.max(1, count) }, { project })
      .then((read) => {
        if (stale) return;
        kept = read.downloads;
        total = read.total;
        problem = null;
      })
      .catch((error: unknown) => {
        if (!stale) problem = error instanceof Error ? error.message : String(error);
      });
    return () => {
      stale = true;
    };
  });

  const size = (bytes: number | null): string =>
    bytes === null
      ? ''
      : bytes < 1024
        ? `${bytes} B`
        : bytes < 2 ** 20
          ? `${Math.round(bytes / 1024)} KB`
          : `${(bytes / 2 ** 20).toFixed(1)} MB`;
</script>

{#if page.downloads > 0}
  <Popover.Root bind:open>
    <Tooltip text="Downloads">
      <Popover.Trigger
        class={[
          'grid shrink-0 place-items-center text-muted-foreground hover:bg-hover hover:text-foreground data-[state=open]:bg-selected',
          touch ? 'size-11 rounded-full' : 'size-7 rounded-md',
        ]}
        aria-label="Downloads"
        data-page-downloads={page.id}
      >
        <Download class="size-4" />
      </Popover.Trigger>
    </Tooltip>
    <Popover.Content align="end" collisionPadding={12} class="w-80 gap-0 p-0">
      <ul class="max-h-96 overflow-y-auto py-1">
        {#each kept as held (held.id)}
          <li class="flex min-h-11 items-center gap-2 px-3 py-1.5">
            <span class="grid min-w-0 flex-1">
              <span class="truncate text-ui">{held.name}</span>
              <span class="truncate text-small text-muted-foreground">
                {held.state === 'done' ? size(held.bytes) : held.state === 'running' ? 'Downloading…' : held.state}
              </span>
            </span>
            {#if held.state === 'done' && held.path !== null}
              <a
                class="shrink-0 rounded-md px-2 py-1 text-small hover:bg-hover"
                href={savedAddress(door, held.path, held.name)}
                download={held.name}>Save</a
              >
            {/if}
          </li>
        {:else}
          <li class="px-3 py-2 text-small text-muted-foreground">{problem ?? 'Reading the downloads…'}</li>
        {/each}
      </ul>
      {#if total > kept.length}
        <p class="border-t px-3 py-1.5 text-small text-muted-foreground">The newest {kept.length} of {total}.</p>
      {/if}
    </Popover.Content>
  </Popover.Root>
{/if}
