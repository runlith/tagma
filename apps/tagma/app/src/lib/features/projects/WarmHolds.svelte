<script lang="ts">
  import { GraphRung, type GraphAim } from '../workspace/GraphRung.js';
  import { Visits } from '../workspace/Visits.svelte.js';
  import { ProjectStrip } from './Strip.svelte.js';
  import WarmHold from './WarmHold.svelte';

  const WARM = 3;

  const strip = ProjectStrip.use();
  const visits = Visits.use();
  const graphAim = GraphRung.Source.use();

  const warm = $derived.by((): readonly GraphAim[] => {
    const here = graphAim();
    return strip.visited
      .slice(0, WARM)
      .map((project) => (here?.projectId === project.id ? here : { projectId: project.id, branch: visits.branchOf(project) }));
  });
</script>

{#each warm as aim (GraphRung.keyOf(aim))}
  <WarmHold {aim} />
{/each}
