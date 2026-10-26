<script lang="ts">
  import type { Cycle } from './Cycle.svelte.js';
  import { labelOf } from '$lib/features/workspace/mark.js';
  import FadeText from '$lib/shared/FadeText.svelte';
  import PulseMarks from './PulseMarks.svelte';
  import Swatch from '$lib/features/workspace/Swatch.svelte';

  let { cycle }: { cycle: Cycle } = $props();
</script>

<div class="pointer-events-none fixed inset-0 z-50 grid place-items-center" data-project-switcher>
  <div
    class="w-80 max-w-full rounded-lg border bg-popover p-1 text-popover-foreground shadow-float"
    role="listbox"
    aria-label="Recent projects"
  >
    {#each cycle.projects as project, index (project.id)}
      <div
        class={['flex items-center gap-2 rounded-md px-2 py-1.5 text-ui', index === cycle.index && 'bg-selected']}
        role="option"
        aria-selected={index === cycle.index}
      >
        <Swatch projectId={project.id} />
        <FadeText class="flex-1" text={labelOf(project)} />
        <PulseMarks projectId={project.id} />
      </div>
    {/each}
  </div>
</div>
