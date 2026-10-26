<script lang="ts">
  import ImageOff from '@lucide/svelte/icons/image-off';
  import { pictureAddress } from '$lib/features/checkout/Repo.js';
  import { diskAddress } from './disk.js';
  import { Door } from '$lib/wire/Door.js';
  import type { Tab } from './tab.js';
  import TabHead from './TabHead.svelte';

  let {
    tab,
    projectId,
    onBack,
    headed = true,
  }: { tab: Tab; projectId: number; onBack?: (() => void) | undefined; headed?: boolean } = $props();

  const door = Door.use();
  const address = $derived(
    tab.rootId === null ? diskAddress(door, tab.path) : pictureAddress(door, projectId, tab.rootId, tab.path, 'working'),
  );

  let size = $state<string | null>(null);
  let failed = $state(false);

  $effect(() => {
    void address;
    size = null;
    failed = false;
  });
</script>

<section class="flex h-full min-h-0 min-w-0 flex-col bg-background" aria-label={tab.path} data-image-tab={tab.path}>
  {#if headed}
    <TabHead path={tab.path} branch={tab.branch} {onBack}>
      {#if size !== null}
        <span class="mr-1 shrink-0 font-mono text-meta tabular-nums text-muted-foreground" data-image-size>{size}</span>
      {/if}
    </TabHead>
  {/if}
  <div class="grid min-h-0 flex-1 place-items-center overflow-auto bg-sunken p-4">
    {#if failed}
      <div class="flex items-center gap-2 text-ui text-muted-foreground" data-image-failed>
        <ImageOff class="size-4" />This picture could not be read.
      </div>
    {:else}
      <img
        src={address}
        alt={tab.path}
        class="max-h-full max-w-full object-contain"
        onload={(event) => {
          const image = event.currentTarget as HTMLImageElement;
          size = `${image.naturalWidth} × ${image.naturalHeight}`;
        }}
        onerror={() => (failed = true)}
      />
    {/if}
  </div>
</section>
