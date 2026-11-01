<script lang="ts">
  import ErrorBoundary from '@runlith/error-boundary/ErrorBoundary.svelte';
  import DialogHost from '@runlith/primitives/DialogHost.svelte';
  import LauncherHost from '@runlith/primitives/LauncherHost.svelte';
  import { type Component, type Snippet, untrack } from 'svelte';
  import { Router } from '@runlith/layer/Router';
  import { SurfaceRegistry } from '$lib/features/workspace/surface.js';
  import { App } from '@runlith/layer/svelte/App.svelte';
  import LinkMenu from '$lib/features/opening/LinkMenu.svelte';
  import { Opening } from '$lib/features/opening/Opening.svelte.js';
  import { Door } from '$lib/wire/Door.js';
  import { ServerOrigin } from '$lib/wire/ServerOrigin.svelte.js';
  import type { AccessRefusal } from '@tagma/server/remote/contract/wire/access';
  import Admitted from './Admitted.svelte';
  import { ExternalLinks } from '$lib/shared/ExternalLinks.js';
  import Refused from './Refused.svelte';
  import TooltipHost from '$lib/shared/ui/tooltip/TooltipHost.svelte';
  import MentionGhost from '$lib/features/threads/MentionGhost.svelte';
  import { Theme } from '$lib/shared/Theme.svelte.js';
  import { reachArtifacts } from './artifactLinks.js';

  let { Shell, refusal, children }: { Shell: Component<{ children: Snippet }>; refusal: AccessRefusal | null; children: Snippet } =
    $props();

  const door = Door.use();
  const theme = Theme.use();
  const router = Router.use();
  const opening = Opening.use();
  const surfaces = SurfaceRegistry.use();
  const app = App.current();

  $effect(() => opening.attach(app));

  $effect(() => {
    if (router.routeId != null) return;
    const moved = surfaces.moved(router.url);
    if (moved !== null) untrack(() => void router.replace(moved));
  });

  $effect(() => theme.paint());

  $effect(() => {
    const onPageHide = () => {
      door.markLeaving();
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    };
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  });

  $effect(() => {
    const pointer = (): void => document.documentElement.setAttribute('data-pointer', '');
    const keyboard = (): void => document.documentElement.removeAttribute('data-pointer');
    window.addEventListener('pointerdown', pointer, { capture: true });
    window.addEventListener('keydown', keyboard, { capture: true });
    return () => {
      window.removeEventListener('pointerdown', pointer, { capture: true });
      window.removeEventListener('keydown', keyboard, { capture: true });
    };
  });

  const origin = ServerOrigin.use();
  const links = ExternalLinks.use();
  $effect(() => reachArtifacts(origin, links));

  function refuseStrayFiles(event: DragEvent): void {
    const transfer = event.dataTransfer;
    if (event.defaultPrevented || transfer === null || !Array.from(transfer.types).includes('Files')) return;
    event.preventDefault();
    transfer.dropEffect = 'none';
  }
</script>

<svelte:window ondragover={refuseStrayFiles} ondrop={refuseStrayFiles} />

{#if router.routeId === '/_desktop/dictation' || router.routeId === '/pair'}
  {@render children()}
{:else if refusal !== null}
  <Refused {refusal} />
{:else if router.routeId?.startsWith('/_desktop/view/')}
  <Admitted>{@render children()}</Admitted>
{:else}
  <Admitted>
    <Shell>{@render children()}</Shell>
  </Admitted>

  <ErrorBoundary id="dialogs">
    <DialogHost
      overlayClass="bg-scrim supports-backdrop-filter:backdrop-blur-xs"
      contentClass="grid place-items-center overflow-y-auto p-4"
    />
  </ErrorBoundary>
  <ErrorBoundary id="launchers"><LauncherHost /></ErrorBoundary>
  <ErrorBoundary id="tooltips"><TooltipHost /></ErrorBoundary>
  <ErrorBoundary id="link menu"><LinkMenu /></ErrorBoundary>
  <ErrorBoundary id="mention-ghost"><MentionGhost /></ErrorBoundary>
{/if}
