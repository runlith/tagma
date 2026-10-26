<script lang="ts">
  import Waiting from '@runlith/chat-ui/Waiting.svelte';
  import { Dictation } from './Dictation.svelte.js';

  const dictation = Dictation.use();
  const BARS = [0.55, 1, 0.75, 0.4];

  const elapsed = $derived(Math.max(0, Math.floor((dictation.now - dictation.startedAt) / 1000)));
  const clock = $derived(`${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`);
</script>

{#if dictation.phase === 'finishing'}
  <Waiting class="size-3.5 text-muted-foreground" />
  <span class="text-small text-muted-foreground">Confirming…</span>
{:else}
  <span class="size-2 shrink-0 animate-pulse rounded-full bg-destructive"></span>
  <span class="text-small tabular-nums text-foreground">{clock}</span>
  {#if dictation.hushed}
    <span class="text-small text-destructive">Can't hear you</span>
  {:else}
    <span class="flex h-3 items-center gap-0.5" aria-hidden="true">
      {#each BARS as weight, index (index)}
        <span
          class="h-3 w-0.5 origin-center rounded-full bg-destructive"
          style:transform={`scaleY(${Math.max(0.15, dictation.level * weight)})`}
        ></span>
      {/each}
    </span>
  {/if}
{/if}
