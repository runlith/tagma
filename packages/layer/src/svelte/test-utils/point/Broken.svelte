<script lang="ts">
  let { label }: { label: string } = $props();

  function fail(): never {
    throw new Error(`broken for ${label}`);
  }
</script>

{fail()}
