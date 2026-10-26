<script lang="ts">
  import type { AccessRefusal } from '@tagma/server/remote/contract/wire/access';

  let { refusal }: { refusal: AccessRefusal } = $props();
</script>

{#await import('$lib/features/devices/Unpaired.svelte') then { default: Unpaired }}
  <Unpaired {refusal} />
{/await}
