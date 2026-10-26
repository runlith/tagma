<script lang="ts">
  import Clapperboard from '@lucide/svelte/icons/clapperboard';
  import type { Video } from '@tagma/server/artifacts/contract/wire/artifacts';
  import { ServerOrigin } from '$lib/wire/ServerOrigin.svelte.js';
  import { doorAddress } from './address.js';
  import { PageStates } from './PageStates.svelte.js';
  import VideoProgress from './VideoProgress.svelte';

  let { page, answered }: { page: string; answered: Video } = $props();

  const states = PageStates.use();
  const server = ServerOrigin.use();

  $effect(() => states.hold(page));

  const reading = $derived(states.state(page));
  const video = $derived(reading === undefined ? answered : (reading.videos.find((one) => one.job === answered.job) ?? null));
  const file = $derived(video?.state === 'ready' && video.url !== null ? doorAddress(server, video.url) : null);
</script>

<div class="grid min-w-0 gap-1.5 rounded-lg border bg-raised p-1.5" data-video-call={answered.job}>
  <div class="flex min-w-0 items-center gap-2 pl-1.5 text-small">
    <Clapperboard class="size-3.5 shrink-0 text-muted-foreground" />
    <span class="min-w-0 flex-1 text-muted-foreground">Video export at {answered.fps} fps</span>
    {#if video === null}
      <span class="text-muted-foreground">Stopped</span>
    {:else}
      <VideoProgress {video} />
    {/if}
  </div>
  {#if file !== null}
    <video class="max-w-md rounded-md bg-sunken" src={file.src} controls preload="metadata"><track kind="captions" /></video>
  {/if}
</div>
