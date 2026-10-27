<script lang="ts">
  import { Host } from '@runlith/layer/Host';
  import { layers } from '@runlith/primitives/layers';
  import { overlayLayers } from '@runlith/primitives/OverlayLayers.svelte';
  import { cubicOut } from 'svelte/easing';
  import { fly } from 'svelte/transition';
  import { Notices } from '$lib/features/notices/Service.svelte.js';
  import NewHostCard from './NewHostCard.svelte';
  import NoticeCard from './NoticeCard.svelte';
  import { Standing } from './Standing.svelte.js';
  const notices = Notices.use();
  const standing = Standing.use();
  const thumb = Host.use().kind === 'mobile';
  const enter = thumb ? { y: 12, duration: 200, easing: cubicOut } : { x: 12, duration: 200, easing: cubicOut };

  const HOST_INCOMPATIBLE = 'terminal-host-incompatible';
  const byHost = $derived(
    standing.newHost === null ? [] : notices.list.filter((notice) => notice.kind === 'refusal' && notice.title === HOST_INCOMPATIBLE),
  );
  const shown = $derived(byHost.length === 0 ? notices.list : notices.list.filter((notice) => !byHost.includes(notice)));
  const later = (): void => {
    standing.putOff();
    for (const notice of byHost) notices.dismiss(notice.id);
  };
</script>

<div
  role="status"
  aria-live="polite"
  class={thumb
    ? 'fixed inset-x-0 bottom-0 safe-bottom safe-x'
    : 'fixed top-[calc(var(--topbar)+0.5rem)] right-4 max-w-[min(calc(var(--spacing)*84),calc(100vw-2rem))]'}
  style:z-index={layers.notice}
  {@attach overlayLayers.notice}
>
  <div
    class={thumb
      ? 'flex max-h-[60dvh] flex-col gap-1.5 overflow-y-auto px-4 pt-2 pb-4'
      : 'flex max-h-[calc(100vh-var(--topbar)-1rem)] flex-col items-end gap-1.5 overflow-y-auto'}
  >
    {#if standing.newHost !== null && (standing.offersNewHost || byHost.length > 0)}
      <div class={thumb ? 'w-full' : 'w-80 max-w-full'} data-notice="new-host" in:fly|global={enter}>
        <NewHostCard needed={standing.newHost} place="notice" {later} />
      </div>
    {/if}
    {#each shown as notice (notice.id)}
      <NoticeCard {notice} {thumb} {enter} />
    {/each}
  </div>
</div>
