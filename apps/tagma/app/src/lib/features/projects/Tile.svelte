<script lang="ts">
  import type { Project } from '@tagma/server/graph/contract/wire/rows';
  import { cn } from '$lib/shared/utils.js';
  import { hueOf, initialsOf, labelOf } from '$lib/features/workspace/mark.js';

  let { project, lit = false }: { project: Project; lit?: boolean } = $props();
</script>

<span
  class={cn(
    'relative grid size-8 shrink-0 place-items-center rounded-md text-small font-semibold select-none',
    lit ? 'project-lit' : 'project-tile',
  )}
  data-tone
  aria-hidden="true"
  ><span class="absolute top-1 left-1 size-1" style:background-color={hueOf(project.id)}></span>{initialsOf(labelOf(project))}</span
>
