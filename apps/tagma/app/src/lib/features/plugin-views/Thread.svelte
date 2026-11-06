<script lang="ts">
  import { ViewThreads } from './ViewThreads.js';

  let { id }: { id: string } = $props();

  const { Seat } = ViewThreads.use();
</script>

<Seat {id} />
