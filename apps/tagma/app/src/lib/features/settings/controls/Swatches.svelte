<script lang="ts">
  let { colours }: { colours: readonly string[] } = $props();
</script>

<span class="flex shrink-0 overflow-hidden rounded-sm border border-vein">
  {#each colours as colour, index (index)}
    <span class="h-3.5 w-1.5" style="background-color: {colour}"></span>
  {/each}
</span>
