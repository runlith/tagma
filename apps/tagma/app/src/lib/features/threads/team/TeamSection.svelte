<script lang="ts">
  import KeyCard from '$lib/features/settings/KeyCard.svelte';
  import { pick, type SectionProps } from '$lib/features/settings/section.js';
  import TeamSettings from './TeamSettings.svelte';

  let { catalog, scope, project }: SectionProps = $props();

  const DELEGATION = ['agent.delegation', 'agent.subAgentDepth'];
</script>

<div class="grid">
  <KeyCard title="Delegation" entries={pick(catalog.entriesOf('team'), DELEGATION)} {catalog} {scope} {project} />
  <TeamSettings {catalog} {scope} {project} />
</div>
