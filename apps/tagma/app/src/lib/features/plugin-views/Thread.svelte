<script lang="ts">
  import { ViewThreads } from './ViewThreads.js';

  let { id }: { id: string } = $props();

  const { Placed } = ViewThreads.use();
</script>

<Placed {id} />
