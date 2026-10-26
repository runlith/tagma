<script lang="ts">
  import { hueOf } from './mark.js';

  let { projectId }: { projectId: number } = $props();
</script>

<span class="grid size-3 shrink-0 place-items-center rounded-sm inset-ring-1 inset-ring-border" aria-hidden="true">
  <span class="size-1.5" style:background-color={hueOf(projectId)}></span>
</span>
