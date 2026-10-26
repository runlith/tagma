<script lang="ts">
  import { untrack } from 'svelte';

  type Props = { run: () => void };
  const props: Props = $props();

  untrack(() => props.run());
</script>
