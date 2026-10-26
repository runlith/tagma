<script lang="ts">
  import type { ClassValue } from 'svelte/elements';

  let { used, color, class: className }: { used: number; color: string; class?: ClassValue } = $props();
</script>

<span class={['block overflow-hidden bg-vein-strong', className]} aria-hidden="true">
  <span class="block h-full transition-all duration-300" style:width="{Math.max(0, Math.min(100, used))}%" style:background={color}></span>
</span>
