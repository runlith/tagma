<script lang="ts">
  import Absent from '$lib/shared/Absent.svelte';
  import { CONTRIBUTED_ROUTE } from './surface.js';

  let { path }: { path: string } = $props();
</script>

<Absent title="No such page">
  This build carries no page at <span class="font-mono">{CONTRIBUTED_ROUTE}/{path}</span>.
</Absent>
