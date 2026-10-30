<script lang="ts">
  import type { Project } from '@tagma/server/graph/contract/wire/rows';
  import { cn } from '$lib/shared/utils.js';
  import { hueOf, initialsOf, labelOf } from '$lib/features/workspace/mark.js';

  let { project, marks = [project.id], lit = false }: { project: Project; marks?: readonly number[]; lit?: boolean } = $props();
</script>

<span
  class={cn(
    'relative grid size-8 shrink-0 place-items-center rounded-md text-small font-semibold select-none',
    lit ? 'project-lit' : 'project-tile',
  )}
  data-tone
  aria-hidden="true"
  ><span class="absolute top-1 right-1 left-1 flex items-start gap-0.5 overflow-hidden"
    >{#each marks as id (id)}<span class="aspect-square max-w-1 min-w-0 flex-1" style:background-color={hueOf(id)}></span>{/each}</span
  >{initialsOf(labelOf(project))}</span
>
