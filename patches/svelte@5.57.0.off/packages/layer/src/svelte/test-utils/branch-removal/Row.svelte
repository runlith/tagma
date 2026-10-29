<script lang="ts">
  let { active, tick }: { active: string; tick: number } = $props();
</script>

{#if tick >= 0 && active === 'one'}<b data-testid="row">{tick}</b>{/if}
