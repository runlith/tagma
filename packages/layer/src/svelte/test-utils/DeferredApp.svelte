<script lang="ts">
  import { Layer } from '../../Layer.js';
  import { App as Core } from '../../App.js';
  import { Visitor, type VisitorInput } from '../../testing.js';
  import { App } from '../App.svelte.js';
  import { Config, SearchLive } from './deferred-fixtures.js';
  import DeferredConsumer from './DeferredConsumer.svelte';

  let { open, twin = false, session }: { open: boolean; twin?: boolean; session: VisitorInput } = $props();

  App.mount(
    Core.define(
      Layer.mergeAll(
        SearchLive,
        Layer.of(Config, new Config('hit')),
        Visitor.of(() => session),
      ),
      { data: 'lazy', ladder: [Visitor] },
    ),
  );
</script>

<svelte:boundary>
  {#snippet pending()}<p data-testid="pending">loading</p>{/snippet}
  {#if open}
    <DeferredConsumer />
    {#if twin}<DeferredConsumer />{/if}
  {/if}
</svelte:boundary>
