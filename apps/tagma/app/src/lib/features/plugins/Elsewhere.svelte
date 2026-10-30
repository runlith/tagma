<script lang="ts">
  import type { Project } from '@tagma/server/graph/contract/wire/rows';
  import Blocks from '@lucide/svelte/icons/blocks';
  import { Button } from '$lib/shared/ui/button/index.js';
  import { Addresses } from '$lib/features/workspace/Addresses.js';
  import { PLUGINS } from '$lib/features/plugins/place.js';

  let { project, what }: { project: Project | null; what: string } = $props();

  const addresses = Addresses.use();
</script>

<div class="flex items-center gap-3 rounded-lg border bg-raised px-3 py-2">
  <Blocks class="size-4 shrink-0 text-muted-foreground" />
  <span class="flex-1 text-ui">{what} are added and managed in Plugins, on the rail of every project.</span>
  {#if project !== null}
    <Button size="sm" variant="outline" href={addresses.place(project.name, PLUGINS, null, null)}>Open Plugins</Button>
  {/if}
</div>
