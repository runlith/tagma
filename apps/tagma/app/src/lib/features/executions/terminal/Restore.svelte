<script lang="ts">
  import { ThreadPlaces } from '$lib/app/panes/ThreadPlaces.js';
  import ProjectHold from '$lib/features/workspace/ProjectHold.svelte';
  import { Readings } from '../load/Readings.svelte.js';

  const places = ThreadPlaces.use();
  const readings = Readings.use();
  const interested = $derived(places.threads.length > 0);
  $effect(() => (interested ? readings.hold() : undefined));
  const projects = $derived([
    ...new Set(
      places.threads.flatMap(
        (thread) =>
          readings.agents
            .get(thread)
            ?.work?.executions.flatMap((execution) => (execution.kind === 'terminal' && !execution.session ? [execution.projectId] : [])) ??
          [],
      ),
    ),
  ]);
</script>

{#each projects as projectId (projectId)}
  <ProjectHold {projectId}>{#snippet children()}{/snippet}</ProjectHold>
{/each}
