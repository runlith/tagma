<script lang="ts">
  import { Host } from '@runlith/layer/Host';
  import { layers } from '@runlith/primitives/layers';
  import { overlayLayers } from '@runlith/primitives/OverlayLayers.svelte';
  import { cubicOut } from 'svelte/easing';
  import { Notices } from '$lib/features/notices/Service.svelte.js';
  import NoticeCard from './NoticeCard.svelte';
  const notices = Notices.use();
  const thumb = Host.use().kind === 'mobile';
  const enter = thumb ? { y: 12, duration: 200, easing: cubicOut } : { x: 12, duration: 200, easing: cubicOut };
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
    {#each notices.list as notice (notice.id)}
      <NoticeCard {notice} {thumb} {enter} />
    {/each}
  </div>
</div>
