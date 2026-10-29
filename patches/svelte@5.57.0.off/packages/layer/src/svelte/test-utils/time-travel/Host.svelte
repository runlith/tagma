<script lang="ts">
  import { Layer } from '../../../Layer.js';
  import { App as Core, type MountedApp } from '../../../App.js';
  import { Visitor, type VisitorInput } from '../../../testing.js';
  import { App } from '../../App.svelte.js';
  import { Probe, ProbeContinuation, ProbeGuard, ProbeLateDependency, World } from './fixtures.svelte.js';
  import Page from './Page.svelte';
  import PageHandle from './PageHandle.svelte';

  export type Door = 'pending' | 'blocking' | 'handle';

  let {
    door,
    engines,
    session,
    open = false,
    second = false,
    twin = false,
    onApp,
  }: {
    door: Door;
    engines: readonly Layer<never, never>[];
    session: VisitorInput;
    open?: boolean;
    second?: boolean;
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
  {#if door === 'pending'}
    <svelte:boundary {failed}>
      {#snippet pending()}<p data-testid="pending">loading</p>{/snippet}
      <Page {second} />
    </svelte:boundary>
    {#if twin}
      <svelte:boundary {failed}>
        {#snippet pending()}<p data-testid="pending">loading</p>{/snippet}
        <Page />
      </svelte:boundary>
    {/if}
  {:else if door === 'blocking'}
    <svelte:boundary {failed}>
      <Page {second} />
      {#if twin}<Page />{/if}
    </svelte:boundary>
  {:else}
    <svelte:boundary {failed}>
      <PageHandle />
      {#if twin}<PageHandle />{/if}
    </svelte:boundary>
  {/if}
{/if}
