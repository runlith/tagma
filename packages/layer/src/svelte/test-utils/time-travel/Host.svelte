<script lang="ts">
  import { Layer } from '../../../Layer.js';
  import { App as Core, type MountedApp } from '../../../App.js';
  import { Visitor, type VisitorInput } from '../../../testing.js';
  import { App } from '../../App.svelte.js';
  import { Probe, ProbeContinuation, ProbeGuard, ProbeLateDependency, World } from './fixtures.svelte.js';
  import PageHandle from './PageHandle.svelte';

  let {
    engines,
    session,
    open = false,
    twin = false,
    onApp,
  }: {
    engines: readonly Layer<never, never>[];
    session: VisitorInput;
    open?: boolean;
    twin?: boolean;
    onApp: (app: MountedApp) => void;
  } = $props();

  onApp(
    App.mount(
      Core.define(
        Layer.mergeAll(
          World,
          Probe,
          ProbeLateDependency,
          ProbeContinuation,
          ProbeGuard,
          ...engines,
          Visitor.of(() => session),
        ),
        { data: 'lazy', ladder: [Visitor] },
      ),
    ),
  );
</script>

{#snippet failed(error: unknown)}
  <p data-testid="failed">{String(error)}</p>
{/snippet}

{#if open}
  <svelte:boundary {failed}>
    <PageHandle />
    {#if twin}<PageHandle />{/if}
  </svelte:boundary>
{/if}
