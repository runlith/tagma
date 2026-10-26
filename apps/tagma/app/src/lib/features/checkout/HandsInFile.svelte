<script lang="ts">
  import { Addresses } from '$lib/features/workspace/Addresses.js';
  import FadeText from '$lib/shared/FadeText.svelte';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import { type Hand, handName } from './DiffReading.svelte.js';

  let { hands }: { hands: readonly Hand[] } = $props();

  const addresses = Addresses.use();

  const HAND = 'flex min-w-2 max-w-40 shrink-100 items-center gap-1.5 overflow-hidden text-small text-muted-foreground';

  function said(hand: Hand): string {
    return `${handName(hand)} wrote ${hand.lines} ${hand.lines === 1 ? 'line' : 'lines'} here`;
  }
</script>

{#snippet face(hand: Hand)}
  <span class="size-2 shrink-0 rounded-sm" style:background={hand.hue}></span>
  <FadeText>
    <span data-diff-hand-name>{handName(hand)}</span>
    <span class="ml-0.5 tabular-nums text-muted-foreground/60" data-diff-hand-lines>{hand.lines}</span>
  </FadeText>
{/snippet}

{#each hands as hand (hand.key)}
  <Tooltip text={said(hand)}>
    {#if hand.author.holder.kind === 'thread'}
      <a
        href={addresses.thread(hand.author.holder.thread)}
        class="{HAND} transition-colors hover:text-foreground"
        aria-label="{said(hand)} — open the thread"
        data-diff-hand={hand.key}
      >
        {@render face(hand)}
      </a>
    {:else}
      <span class={HAND} aria-label={said(hand)} data-diff-hand={hand.key}>
        {@render face(hand)}
      </span>
    {/if}
  </Tooltip>
{/each}
