<script lang="ts">
  let { taken, beside = 0 }: { taken: number; beside?: number } = $props();

  const first = $derived(Math.min(1, Math.max(0, taken)));
  const second = $derived(Math.min(1 - first, Math.max(0, beside)));
</script>

<span class="flex h-1 overflow-hidden bg-sunken" aria-hidden="true">
  <span class="bg-brand" style:width="{first * 100}%"></span>
  <span class="bg-muted-foreground/35" style:width="{second * 100}%"></span>
</span>
