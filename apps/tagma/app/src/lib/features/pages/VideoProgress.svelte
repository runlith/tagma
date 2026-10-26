<script lang="ts">
  import Download from '@lucide/svelte/icons/download';
  import X from '@lucide/svelte/icons/x';
  import type { Video } from '@tagma/server/artifacts/contract/wire/artifacts';
  import { Links } from '$lib/features/browser/Links.svelte.js';
  import Bar from '$lib/shared/ui/Bar.svelte';
  import { Button } from '$lib/shared/ui/button/index.js';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import { ServerOrigin } from '$lib/wire/ServerOrigin.svelte.js';
  import { toldOf } from '$lib/wire/refusal.js';
  import { doorAddress } from './address.js';
  import { VideosRepo } from './VideosRepo.js';

  let { video }: { video: Video } = $props();

  const links = Links.use();
  const server = ServerOrigin.use();
  const videos = VideosRepo.use();

  let refused = $state<string | null>(null);

  const file = $derived(video.url === null ? null : doorAddress(server, video.url));
  const share = $derived(video.total === 0 ? 0 : video.frames / video.total);
  const megabytes = $derived(video.bytes === null ? null : (video.bytes / 1e6).toFixed(1));

  async function stop(): Promise<void> {
    refused = null;
    try {
      await videos.cancel.run(video.job, { throwOnError: true });
    } catch (error) {
      refused = toldOf(error).text;
    }
  }
</script>

<span class="flex shrink-0 items-center gap-1 text-small tabular-nums" data-video={video.job} data-video-state={video.state}>
  {#if video.state === 'ready' && file !== null}
    <Tooltip text={`Download the ${video.scale}× video, ${megabytes} MB`}>
      <Button variant="ghost" size="sm" class="h-7 gap-1 px-1.5" onclick={() => links.system(file.href)}>
        <Download class="size-3.5" />MP4 {video.scale}×
      </Button>
    </Tooltip>
  {:else if video.state === 'failed'}
    <Tooltip text={video.problem ?? 'The export failed'}>
      <span class="px-1.5 text-destructive">MP4 {video.scale}× failed</span>
    </Tooltip>
  {:else}
    <span class="flex items-center gap-2 px-1.5">
      <span>MP4 {video.scale}×</span>
      <Bar used={share * 100} color="var(--status-in-work)" class="h-1 w-12 shrink-0" />
      <span class="text-muted-foreground">{video.state === 'queued' ? 'waiting' : `${Math.floor(share * 100)}%`}</span>
    </span>
    <Tooltip text={refused ?? 'Stop the export'}>
      <Button
        variant="ghost"
        size="icon-sm"
        class={refused === null ? undefined : 'text-destructive'}
        aria-label={`Stop the ${video.scale}× export`}
        disabled={videos.cancel.pending}
        onclick={() => void stop()}
      >
        <X class="size-3.5" />
      </Button>
    </Tooltip>
  {/if}
</span>
