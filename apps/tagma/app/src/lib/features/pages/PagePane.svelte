<script lang="ts">
  import { versionAddress } from '@tagma/server/artifacts/contract/wire/artifacts';
  import { Keymap } from '$lib/app/keys/Keymap.svelte.js';
  import { SidePanes } from '$lib/app/panes/SidePanes.svelte.js';
  import FadeText from '$lib/shared/FadeText.svelte';
  import type { SidePane } from '$lib/shared/panes/pane.js';
  import { zoomStep } from '$lib/features/browser/zoom.js';
  import ZoomControls from '$lib/features/browser/ZoomControls.svelte';
  import { ServerOrigin } from '$lib/wire/ServerOrigin.svelte.js';
  import { doorAddress } from './address.js';
  import PageActions from './PageActions.svelte';
  import { PageStates } from './PageStates.svelte.js';
  import PageView from './PageView.svelte';
  import { PageZoom } from './PageZoom.svelte.js';
  import VideoExport from './VideoExport.svelte';

  let { pane }: { pane: SidePane; close: () => void } = $props();

  const states = PageStates.use();
  const zooms = PageZoom.use();
  const server = ServerOrigin.use();
  const panes = SidePanes.use();
  const keymap = Keymap.use();

  $effect(() => {
    if (pane.id !== null) return states.hold(pane.id);
  });

  const current = $derived(pane.id === null ? null : (states.state(pane.id)?.current ?? null));
  const shown = $derived(current === null ? null : doorAddress(server, versionAddress(current)));
  const page = $derived(current === null ? null : doorAddress(server, current.url));
  const zoomable = $derived(current !== null && current.timeline === null);
  const zoom = $derived(pane.id === null || !zoomable ? 1 : zooms.zoom(pane.id));

  const zoomTo = (factor: number) => {
    if (pane.id !== null) zooms.set(pane.id, factor);
  };

  $effect(() => {
    const frame = shown?.href;
    if (!zoomable || frame === undefined) return;
    const bound = (action: string, factor: () => number) =>
      keymap.handle(
        action,
        ({ page: at, frame: from }) => {
          if (at !== null || (from === null && panes.focus !== pane.key)) return false;
          zoomTo(factor());
          return true;
        },
        frame,
      );
    const releases = [
      bound('page.zoom-in', () => zoomStep(zoom, 1)),
      bound('page.zoom-out', () => zoomStep(zoom, -1)),
      bound('page.zoom-reset', () => 1),
    ];
    return () => {
      for (const release of releases) release();
    };
  });
</script>

<section class="flex h-full min-h-0 min-w-0 flex-col" aria-label={current?.title ?? 'Published page'} data-artifact-pane={pane.id}>
  {#if current !== null && shown !== null}
    <header class="flex h-8 min-w-0 shrink-0 items-center gap-2 border-b pr-1 pl-3">
      <FadeText class="flex-1 text-small text-muted-foreground" text={current.description ?? ''} />
      {#if zoomable}
        <div class="flex shrink-0 items-center">
          <ZoomControls {zoom} {zoomTo} />
        </div>
      {/if}
      {#if page !== null}
        <PageActions href={page.href} />
      {/if}
    </header>
    <div class="min-h-0 flex-1">
      {#key shown.src}
        <PageView src={shown.src} title={current.title} timeline={current.timeline} fill {zoom}>
          {#snippet actions()}
            {#if current.timeline !== null}
              <VideoExport page={current.id} version={current.version} timeline={current.timeline} />
            {/if}
          {/snippet}
        </PageView>
      {/key}
    </div>
  {/if}
</section>
