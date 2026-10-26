<script lang="ts">
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import type { PublishedPage } from '@tagma/server/artifacts/contract/wire/published';
  import { Host } from '@runlith/layer/Host';
  import { SidePanes } from '$lib/app/panes/SidePanes.svelte.js';
  import { ThreadPlaces } from '$lib/app/panes/ThreadPlaces.js';
  import FadeText from '$lib/shared/FadeText.svelte';
  import { timeCompact } from '$lib/shared/time.js';
  import { Button } from '$lib/shared/ui/button/index.js';
  import { ServerOrigin } from '$lib/wire/ServerOrigin.svelte.js';
  import { doorAddress } from './address.js';
  import PageActions from './PageActions.svelte';
  import { PageStates } from './PageStates.svelte.js';
  import PageView from './PageView.svelte';
  import VideoExport from './VideoExport.svelte';
  import { showArtifact } from './panes.js';
  import { motionWidth, previewHeight } from './sizing.js';

  let { published, thread }: { published: PublishedPage; thread: string | null } = $props();

  const states = PageStates.use();
  const server = ServerOrigin.use();
  const sides = SidePanes.use();
  const seats = ThreadPlaces.use();
  const panel = Host.use().kind !== 'mobile';

  $effect(() => states.hold(published.id));

  let opened = $state(false);

  const reading = $derived(states.state(published.id));
  const standing = $derived.by((): 'unknown' | 'current' | 'replaced' | 'gone' => {
    if (reading === undefined) return 'unknown';
    if (reading.current?.version === published.version) return 'current';
    return reading.kept.includes(published.version) ? 'replaced' : 'gone';
  });
  const own = $derived(doorAddress(server, published.versionUrl));
  const page = $derived(doorAddress(server, published.url));
  const linked = $derived(standing === 'replaced' ? own : page);

  function beside(): void {
    showArtifact(sides, seats, thread, published.id);
  }
</script>

{#if standing === 'replaced' && !opened}
  <button
    type="button"
    class="flex w-full min-w-0 items-center gap-2 rounded-lg border px-3 py-1.5 text-left text-small hover:bg-hover"
    aria-expanded="false"
    onclick={() => (opened = true)}
    data-page-card={published.id}
    data-page-standing="replaced"
  >
    <ChevronRight class="size-3.5 shrink-0 text-muted-foreground" />
    <FadeText class="min-w-0 flex-1 font-medium" text={published.title} />
    <span class="shrink-0 text-muted-foreground">Replaced by a newer version</span>
  </button>
{:else}
  <article
    class="grid min-w-0 gap-1.5 rounded-lg border bg-raised p-1.5"
    aria-label={published.title}
    data-page-card={published.id}
    data-page-standing={standing}
  >
    <header class="flex min-w-0 items-start gap-2 pl-1.5">
      {#if standing === 'replaced'}
        <Button variant="ghost" size="icon-sm" aria-label="Fold" aria-expanded="true" onclick={() => (opened = false)}>
          <ChevronDown class="size-3.5" />
        </Button>
      {/if}
      <div class="grid min-w-0 flex-1">
        <div class="flex min-w-0 items-center gap-2">
          <FadeText class="min-w-0 flex-1 text-ui font-medium" text={published.title} />
          <span class="shrink-0 text-meta tabular-nums text-muted-foreground">{timeCompact(published.publishedAt)}</span>
          {#if linked !== null}
            <PageActions href={linked.href} beside={panel ? beside : undefined} />
          {/if}
        </div>
        {#if published.description !== null}
          <FadeText class="text-small text-muted-foreground" text={published.description} />
        {/if}
      </div>
    </header>
    {#if standing === 'replaced'}
      <p class="px-1.5 text-small text-muted-foreground">A newer version replaced this one.</p>
    {/if}
    <div class="overflow-hidden rounded-md">
      {#if standing === 'gone'}
        <div class="grid justify-items-start gap-2 bg-sunken px-3 py-3">
          <p class="text-small text-muted-foreground">This version is no longer kept.</p>
          {#if reading?.current != null && panel}
            <Button variant="outline" size="sm" onclick={beside}>Show the current version</Button>
          {/if}
        </div>
      {:else if standing === 'unknown' || own === null}
        {#if published.timeline !== null}
          <div
            class="max-w-full bg-sunken"
            style:aspect-ratio={`${published.timeline.width} / ${published.timeline.height}`}
            style:width={motionWidth(published.timeline)}
          ></div>
        {:else}
          <div class="bg-sunken" style:height={`${previewHeight()}px`}></div>
        {/if}
      {:else}
        <PageView src={own.src} title={published.title} timeline={published.timeline} open={panel ? beside : undefined}>
          {#snippet actions()}
            {#if published.timeline !== null}
              <VideoExport page={published.id} version={published.version} timeline={published.timeline} />
            {/if}
          {/snippet}
        </PageView>
      {/if}
    </div>
  </article>
{/if}
