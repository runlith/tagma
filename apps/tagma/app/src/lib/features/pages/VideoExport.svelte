<script lang="ts">
  import Clapperboard from '@lucide/svelte/icons/clapperboard';
  import Download from '@lucide/svelte/icons/download';
  import { type Video, VIDEO_SCALES, type VideoScale } from '@tagma/server/artifacts/contract/wire/artifacts';
  import type { Timeline } from '@tagma/server/artifacts/contract/wire/timeline';
  import { Links } from '$lib/features/browser/Links.svelte.js';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import { ServerOrigin } from '$lib/wire/ServerOrigin.svelte.js';
  import { toldOf } from '$lib/wire/refusal.js';
  import { doorAddress } from './address.js';
  import { PageStates } from './PageStates.svelte.js';
  import VideoProgress from './VideoProgress.svelte';
  import { VideosRepo } from './VideosRepo.js';

  let { page, version, timeline }: { page: string; version: string; timeline: Timeline } = $props();

  const states = PageStates.use();
  const repo = VideosRepo.use();
  const links = Links.use();
  const server = ServerOrigin.use();

  let asked = $state<readonly string[]>([]);

  const made = $derived((states.state(page)?.videos ?? []).filter((video) => video.version === version));
  const taken = $derived(new Set(made.filter((video) => video.state !== 'failed').map((video) => video.scale)));
  const refused = $derived(repo.export.error === null || repo.export.error === undefined ? null : toldOf(repo.export.error).text);

  function download(video: Video): void {
    const file = video.url === null ? null : doorAddress(server, video.url);
    if (file !== null) links.system(file.href);
  }

  async function start(scale: VideoScale): Promise<void> {
    const answer = await repo.export.run({ page, version, scale });
    if (answer === undefined) return;
    if (answer.status === 'exported') download(answer.video);
    else asked = [...asked, answer.video.job];
  }

  $effect(() => {
    const settled = made.filter((video) => asked.includes(video.job) && (video.state === 'ready' || video.state === 'failed'));
    if (settled.length === 0) return;
    asked = asked.filter((job) => !settled.some((video) => video.job === job));
    for (const video of settled) if (video.state === 'ready') download(video);
  });
</script>

{#each made as video (video.job)}
  <VideoProgress {video} />
{/each}
<DropdownMenu.Root>
  <Tooltip text={refused ?? 'Export as MP4'}>
    <DropdownMenu.Trigger
      class={[
        'flex size-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-hover data-[state=open]:bg-selected',
        refused === null ? 'text-muted-foreground' : 'text-destructive',
      ]}
      aria-label="Export as MP4"
      disabled={repo.export.pending}
    >
      <Clapperboard class="size-3.5" />
    </DropdownMenu.Trigger>
  </Tooltip>
  <DropdownMenu.Content align="end" class="min-w-44">
    {#each VIDEO_SCALES as scale (scale)}
      <DropdownMenu.Item
        icon={Download}
        hint={`${timeline.width * scale}×${timeline.height * scale}`}
        disabled={taken.has(scale)}
        onSelect={() => void start(scale)}
      >
        Export MP4 {scale}×
      </DropdownMenu.Item>
    {/each}
  </DropdownMenu.Content>
</DropdownMenu.Root>
