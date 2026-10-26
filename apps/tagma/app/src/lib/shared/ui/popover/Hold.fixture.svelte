<script lang="ts">
  import { Popover } from '@runlith/primitives/popover.svelte';

  const popover = Popover.use();
</script>

<button data-hold onclick={() => popover.hold()}>Hold</button>
