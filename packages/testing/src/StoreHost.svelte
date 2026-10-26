<script lang="ts" generics="T">
  import { untrack } from 'svelte';

  type Props = {
    create: () => T;
    onReady: (store: T) => void;
  };

  const props: Props = $props();

  untrack(() => props.onReady(props.create()));
</script>
