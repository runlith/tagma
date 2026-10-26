<script lang="ts">
  import Mic from '@lucide/svelte/icons/mic';
  import Square from '@lucide/svelte/icons/square';
  import Volume2 from '@lucide/svelte/icons/volume-2';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import { Calls } from './calls/Calls.svelte.js';
  import { Captures } from './Captures.svelte.js';

  const captures = Captures.use();
  const calls = Calls.use();
  const TICK_MS = 1_000;

  let now = $state(Date.now());

  const open = $derived(captures.open.filter((capture) => capture.id !== calls.call?.id));
  const since = $derived(open.length === 0 ? null : Math.min(...open.map((capture) => Date.parse(capture.startedAt))));
  const sources = $derived(new Set(open.flatMap((capture) => capture.sources)));
  const listenings = $derived(open.filter((capture) => capture.kind === 'listening').length);
  const recognitions = $derived(open.length - listenings);
  const clock = $derived.by(() => {
    if (since === null) return '';
    const seconds = Math.max(0, Math.floor((now - since) / 1000));
    const minutes = Math.floor(seconds / 60);
    const rest = String(seconds % 60).padStart(2, '0');
    return minutes >= 60 ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
  });
  const what = $derived(
    [
      listenings > 0 && `${listenings} listening${listenings === 1 ? '' : 's'}`,
      recognitions > 0 && `${recognitions} recognition${recognitions === 1 ? '' : 's'}`,
    ]
      .filter((part) => part !== false)
      .join(' · '),
  );
  const where = $derived(
    open.every((capture) => capture.at === 'caller')
      ? 'on a paired device'
      : open.some((capture) => capture.at === 'caller')
        ? 'on the machine running Tagma and on a paired device'
        : 'on the machine running Tagma',
  );
  const heard = $derived(
    [sources.has('mic') && 'microphone', sources.has('system') && 'system audio'].filter((part) => part !== false).join(' and '),
  );

  $effect(() => {
    if (since === null) return;
    now = Date.now();
    const ticker = setInterval(() => (now = Date.now()), TICK_MS);
    return () => clearInterval(ticker);
  });
</script>

{#if open.length > 0}
  <div
    class="no-drag-region flex h-7 shrink-0 items-center gap-2 rounded-full bg-hover pr-1 pl-3 text-small"
    role="status"
    aria-label={`Recording ${heard}: ${what}`}
  >
    <span class="size-2 shrink-0 animate-pulse rounded-full bg-destructive"></span>
    <span class="tabular-nums text-foreground">{clock}</span>
    <Tooltip text={`${what} — capturing ${heard} ${where}`}>
      <span class="flex items-center gap-1 text-muted-foreground">
        {#if sources.has('mic')}<Mic class="size-3.5" />{/if}
        {#if sources.has('system')}<Volume2 class="size-3.5" />{/if}
        {#if open.length > 1}<span class="tabular-nums">{open.length}</span>{/if}
      </span>
    </Tooltip>
    <button
      type="button"
      class="flex h-5 items-center gap-1 rounded-full px-2 text-small font-medium text-destructive transition-colors hover:bg-hover-danger disabled:opacity-50"
      disabled={captures.stopping}
      onclick={() => void captures.stop(open)}
    >
      <Square class="size-3 fill-current" />
      Stop
    </button>
  </div>
{/if}
