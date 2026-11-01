<script lang="ts">
  import RotateCw from '@lucide/svelte/icons/rotate-cw';
  import Waiting from '@runlith/chat-ui/Waiting.svelte';
  import WifiOff from '@lucide/svelte/icons/wifi-off';
  import { onDestroy, type Snippet } from 'svelte';
  import { notificationTag } from '@tagma/server/push/contract/wire/push';
  import { Host } from '@runlith/layer/Host';
  import { Platform } from '@runlith/layer/Platform';
  import { Router } from '@runlith/layer/Router';
  import { ServiceWorkers } from '$lib/shared/workers/ServiceWorkers.js';
  import { Push } from '$lib/features/devices/Push.svelte.js';
  import { machineName, sentenceStart } from '$lib/features/shell/machine.js';
  import { SurfaceRegistry } from '$lib/features/workspace/surface.js';
  import { WallClock } from '$lib/features/workspace/WallClock.svelte.js';
  import { Live } from '$lib/wire/Live.js';
  import { Attention } from '../attention/Attention.svelte.js';
  import { WireState } from '../chrome/WireState.svelte.js';
  import RestartNotice from '../chrome/RestartNotice.svelte';
  import { Restart } from '$lib/wire/Restart.svelte.js';
  import Elsewhere from './Elsewhere.svelte';
  import { Screen } from './Screen.svelte.js';
  import { Viewport } from './Viewport.svelte.js';

  let { children }: { children: Snippet } = $props();

  const RECONNECTING_MS = 2_000;
  const UNREACHABLE_MS = 8_000;

  const screen = Screen.use();
  const live = Live.use();
  const wire = WireState.use();
  const restart = Restart.use();
  const clock = WallClock.use();
  const viewport = new Viewport();
  const ios = Host.use().os === 'ios';
  const router = Router.use();
  const workers = ServiceWorkers.use();
  const machine = machineName(Platform.use().storage.local);
  const Machine = sentenceStart(machine);

  onDestroy(
    router.onNavigate({
      after: (navigation) => {
        if (navigation.type === 'enter') screen.enter();
      },
    }),
  );

  let shell: HTMLDivElement | undefined = $state();

  $effect(() => (shell === undefined ? undefined : viewport.watch(shell)));

  const push = Push.use();
  const attention = Attention.use();

  $effect(() => {
    if (!attention.known || attention.hidden > 0) return;
    const waiting = new Set([
      ...attention.rows.filter((row) => row.kind !== 'finished').map((row) => row.threadId),
      ...attention.notified.filter((row) => row.question !== null).map((row) => notificationTag(row.id)),
    ]);
    void push.settle(waiting, waiting.size);
  });

  $effect(() => {
    const root = document.documentElement;
    root.dataset.shell = 'mobile';
    return () => delete root.dataset.shell;
  });

  $effect(() => {
    if (!ios) return;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (meta !== null && !meta.content.includes('maximum-scale')) meta.content = `${meta.content}, maximum-scale=1`;
  });

  $effect(() => {
    workers.register().catch((error: unknown) => console.error('[tagma] the service worker did not register', error));
  });

  $effect(() => (wire.downSince !== null ? clock.watch() : undefined));

  const downFor = $derived(wire.downSince === null ? 0 : clock.now - wire.downSince);
  const cold = $derived(!wire.opened && downFor > RECONNECTING_MS);
  const unreachable = $derived(!cold && downFor > UNREACHABLE_MS);
  const reconnecting = $derived(!cold && !unreachable && downFor > RECONNECTING_MS);
  const surfaces = SurfaceRegistry.use();
  const surface = $derived(surfaces.of(router.routeId, router.params));
  const elsewhere = $derived(Boolean(router.params.project) && surface !== surfaces.home && surfaces.find(surface)?.phone !== true);

  function tryAgain(): void {
    live.reopen();
  }
</script>

<div
  bind:this={shell}
  class="fixed inset-x-0 top-0 flex h-dvh flex-col overflow-hidden bg-chrome contain-layout safe-top safe-x safe-bottom"
>
  {#if cold}
    <div class="grid flex-1 place-items-center bg-background px-8">
      <div class="grid max-w-xs justify-items-center gap-3 text-center">
        <WifiOff class="size-4 text-muted-foreground" />
        <h1 class="text-page">Can't reach {machine}</h1>
        <p class="text-body text-muted-foreground">
          {Machine} is asleep or Tagma isn't running there, or Tailscale is off on this phone.
        </p>
        <button
          type="button"
          class="mt-2 flex min-h-11 items-center gap-2 rounded-full bg-primary px-5 text-body font-medium text-primary-foreground active:opacity-90"
          onclick={tryAgain}
        >
          <RotateCw class="size-4" />
          Try again
        </button>
      </div>
    </div>
  {:else}
    <RestartNotice silence={false} />
    {#if (unreachable || reconnecting) && !restart.announced}
      <div class="flex shrink-0 items-center gap-2 border-b bg-sunken px-4 py-2 text-small text-muted-foreground" role="status">
        {#if unreachable}
          <WifiOff class="size-3.5 shrink-0" />
          <span class="min-w-0 flex-1">Can't reach {machine} — showing what was last loaded</span>
          <button type="button" class="-my-2 -mr-2 min-h-11 shrink-0 px-3 font-medium text-foreground" onclick={tryAgain}>Retry</button>
        {:else}
          <Waiting class="size-3.5" />
          <span class="min-w-0 flex-1">Reconnecting…</span>
        {/if}
      </div>
    {/if}
    <div class="flex min-h-0 flex-1 flex-col bg-background">
      {#if elsewhere}
        <Elsewhere />
      {:else}
        {@render children()}
      {/if}
    </div>
  {/if}
</div>
