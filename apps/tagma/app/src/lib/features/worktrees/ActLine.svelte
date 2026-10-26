<script lang="ts">
  import Waiting from '@runlith/chat-ui/Waiting.svelte';
  import type { ClassValue } from 'svelte/elements';
  import type { InFlight } from './Finishing.svelte.js';
  import { ACT_WORDS, PHASE_WORDS } from './finishWords.js';

  let { flight, phase = true, class: className = '' }: { flight: InFlight; phase?: boolean; class?: ClassValue } = $props();

  let now = $state(Date.now());

  $effect(() => {
    const tick = setInterval(() => (now = Date.now()), 1_000);
    return () => clearInterval(tick);
  });

  const seconds = $derived(Math.max(0, Math.floor((now - flight.since) / 1_000)));
  const elapsed = $derived(seconds < 3 ? null : seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`);
</script>

<span
  class={['inline-flex min-w-0 items-center gap-1.5 text-small leading-none whitespace-nowrap text-muted-foreground', className]}
  role="status"
  data-worktree-act={flight.act}
  data-worktree-phase={flight.phase}
>
  <Waiting class="size-3" />
  <span class="shrink-0">{ACT_WORDS[flight.act]}</span>
  {#if phase && flight.phase !== null}
    <span class="-ml-0.5 min-w-0 truncate text-muted-foreground/70">{`· ${PHASE_WORDS[flight.phase]}`}</span>
  {/if}
  {#if elapsed !== null}<span class="shrink-0 tabular-nums text-muted-foreground/60">{elapsed}</span>{/if}
</span>
