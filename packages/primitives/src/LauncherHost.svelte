<script lang="ts">
  import type { Component } from 'svelte';

  import ErrorBoundary from '@runlith/error-boundary/ErrorBoundary.svelte';

  import { Launchers } from './Launchers.svelte';

  const launchers = Launchers.use();
</script>

{#each launchers.elements as entry (entry.id)}
  {@const LauncherComponent = entry.component as Component}
  {#if entry.open}
    <div
      style="display:contents;"
      data-launcher-id={entry.id}
      data-launcher-key={entry.key}
      {@attach () => launchers.markPresented(entry.handle)}
    >
      <ErrorBoundary id={`overlay:${entry.key ?? entry.id}`}>
        <LauncherComponent {...entry.props} />
      </ErrorBoundary>
    </div>
  {/if}
{/each}
