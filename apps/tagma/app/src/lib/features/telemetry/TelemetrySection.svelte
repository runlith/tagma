<script lang="ts">
  import KeyCard from '$lib/features/settings/KeyCard.svelte';
  import { pick, rest, type SectionProps } from '$lib/features/settings/section.js';

  let { catalog, scope, project }: SectionProps = $props();

  const STORAGE = ['telemetry.maxStoredBytes', 'telemetry.maxPendingBytes'];
  const SAMPLING = [
    'telemetry.keepOneTraceIn',
    'telemetry.spanFloorMicros',
    'telemetry.vitalsIntervalMs',
    'telemetry.cpuSampler',
    'telemetry.metricsIntervalMs',
  ];

  const entries = $derived(catalog.entriesOf('telemetry'));
</script>

<div class="grid">
  <KeyCard title="Storage" entries={pick(entries, STORAGE)} {catalog} {scope} {project} />
  <KeyCard title="Sampling" entries={pick(entries, SAMPLING)} {catalog} {scope} {project} />
  {#if rest(entries, [...STORAGE, ...SAMPLING]).length > 0}
    <KeyCard title="More" entries={rest(entries, [...STORAGE, ...SAMPLING])} {catalog} {scope} {project} />
  {/if}
</div>
