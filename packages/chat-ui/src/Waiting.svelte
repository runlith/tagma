<script lang="ts">
  import type { ClassValue } from 'svelte/elements';
  import { inStep } from './inStep';

  let { label, class: className }: { label?: string; class?: ClassValue } = $props();
</script>

<svg
  class={['shrink-0', className]}
  viewBox="0 0 12 12"
  fill="currentColor"
  role={label === undefined ? undefined : 'status'}
  aria-label={label}
  aria-hidden={label === undefined ? 'true' : undefined}
  data-waiting
  {@attach inStep}
>
  <rect class="animate-march" x="0" y="4.5" width="3" height="3" />
  <rect class="animate-march" x="4.5" y="4.5" width="3" height="3" />
  <rect class="animate-march" x="9" y="4.5" width="3" height="3" />
</svg>

<style>
  rect:nth-child(2) {
    animation-delay: calc(var(--beat) / 8);
  }

  rect:nth-child(3) {
    animation-delay: calc(var(--beat) / 4);
  }
</style>
