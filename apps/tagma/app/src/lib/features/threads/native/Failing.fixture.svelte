<script lang="ts">
  let { contributor }: { contributor: string } = $props();

  throw new Error(`The contributed part ${contributor} failed to start.`);
</script>
