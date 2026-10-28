<script lang="ts">
  import type { Snippet } from 'svelte';
  import { markMoves, type RailPlace } from './activity';
  import { inStep } from './inStep';

  type Props = {
    dot?: string;
    place?: RailPlace;
    children: Snippet;
  };

  let { dot = 'bg-muted-foreground/25', place = 'only', children }: Props = $props();

  const THREAD = {
    only: '',
    first: 'top-[11.5px] bottom-0',
    middle: 'top-0 bottom-0',
    last: 'top-0 h-[11.5px]',
  } as const;
</script>

<div class="relative py-0.5 pl-4">
  {#if place !== 'only'}
    <span class={['absolute left-[2.5px] w-px bg-border/50', THREAD[place]]}></span>
  {/if}
  {#key dot}<span class={['absolute top-[8.5px] left-0 size-1.5', dot]} {@attach markMoves(dot) && inStep}></span>{/key}
  {@render children()}
</div>
