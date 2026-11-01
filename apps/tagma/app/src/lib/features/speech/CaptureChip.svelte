<script lang="ts">
  import type { Capture } from '@tagma/server/speech/contract/wire/feeds';
  import Mic from '@lucide/svelte/icons/mic';
  import Square from '@lucide/svelte/icons/square';
  import Volume2 from '@lucide/svelte/icons/volume-2';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import { Captures } from './Captures.svelte.js';

  const captures = Captures.use();
  const TICK_MS = 1_000;

  let now = $state(Date.now());

  const open = $derived(captures.unclaimed);
  const since = $derived(open.length === 0 ? null : Math.min(...open.map((capture) => Date.parse(capture.startedAt))));
  const sources = $derived(new Set(open.flatMap((capture) => capture.sources)));
  const counted = $derived.by(() => {
    const kinds = new Map<string, { count: number; noun: Capture['noun'] }>();
    for (const capture of open) {
      const standing = kinds.get(capture.kind);
      kinds.set(capture.kind, { count: (standing?.count ?? 0) + 1, noun: capture.noun });
    }
    return [...kinds.values()];
  });
  const clock = $derived.by(() => {
    if (since === null) return '';
    const seconds = Math.max(0, Math.floor((now - since) / 1000));
    const minutes = Math.floor(seconds / 60);
    const rest = String(seconds % 60).padStart(2, '0');
    return minutes >= 60 ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
  });
  const what = $derived(counted.map(({ count, noun }) => `${count} ${count === 1 ? noun.one : noun.many}`).join(', '));
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
