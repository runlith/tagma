<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { SurfaceKind, SurfaceRefusal } from '@tagma/desktop/bridge';
  import Waiting from '@runlith/chat-ui/Waiting.svelte';
  import FadeText from '$lib/shared/FadeText.svelte';
  import Told from '$lib/shared/Told.svelte';
  import { DesktopSurface } from '$lib/shared/desktop/DesktopSurface.js';

  let { dot, button }: { dot: Snippet<['ok' | 'info']>; button: string } = $props();

  const surface = DesktopSurface.find();
  let current = $state<SurfaceKind | null>(null);
  let pending = $state<SurfaceKind | null>(null);
  let refused = $state<SurfaceRefusal | null>(null);

  if (surface !== undefined) void surface.current().then((kind) => (current = kind));

  const next = $derived<SurfaceKind>(current === 'dev' ? 'built' : 'dev');

  async function use(kind: SurfaceKind): Promise<void> {
    if (surface === undefined || pending !== null) return;
    pending = kind;
    refused = null;
    refused = await surface.use(kind);
    pending = null;
  }
</script>

{#if surface !== undefined && current !== null}
  <div
    class="grid min-h-9 grid-cols-[6px_48px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 rounded-md py-1 pr-1 pl-3"
    data-standing-surface={current}
  >
    {@render dot(current === 'dev' ? 'info' : 'ok')}
    <span class="font-medium">Surface</span>
    <span class="flex min-w-0 items-center gap-1.5 text-small text-muted-foreground">
      {#if pending !== null}
        <Waiting class="size-3 shrink-0 text-status-in-work" />
        <FadeText text={pending === 'dev' ? 'starting Vite of the checkout' : 'back to the built surface'} />
      {:else}
        <FadeText>
          <span class="text-foreground">{current}</span>
          {current === 'dev' ? 'from Vite of the checkout' : 'with the installation'}
        </FadeText>
      {/if}
    </span>
    <button type="button" class={button} disabled={pending !== null} onclick={() => void use(next)}>
      {next === 'dev' ? 'Dev' : 'Built'}
    </button>
    {#if refused !== null}
      <Told
        told={{ text: refused.said ?? 'Vite of the checkout did not start.', details: [`${refused.code}: ${refused.reason}`] }}
        class="col-span-3 col-start-2 text-destructive"
      />
    {/if}
  </div>
{/if}
