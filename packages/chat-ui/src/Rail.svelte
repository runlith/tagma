<script lang="ts">
  import type { Snippet } from 'svelte';
  import { type RailPlace, railPlace } from './activity';

  type Props = {
    count: number;
    children: Snippet<[(index: number) => RailPlace]>;
  };

  let { count, children }: Props = $props();
</script>

<div class="flex flex-col">
  {@render children((index) => railPlace(index, count))}
</div>
