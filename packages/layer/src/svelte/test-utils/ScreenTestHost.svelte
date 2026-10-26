<script lang="ts">
  import { untrack, type Snippet } from 'svelte';

  import { Layer, type LayerLike } from '../../Layer.js';
  import { App as Core } from '../../App.js';
  import { Visitor } from '../../testing.js';
  import { App } from '../App.svelte.js';
  import Probe from './Probe.svelte';

  type Props = { boot: LayerLike; run: () => void; probe?: () => void; children?: Snippet };
  const props: Props = $props();

  App.mount(
    Core.define(
      Layer.mergeAll(
        props.boot,
        Visitor.of(() => Visitor.guest()),
      ),
      { ladder: [Visitor] },
    ),
  );
  untrack(() => props.run());
</script>

{#if props.probe}<Probe run={props.probe} />{/if}
{@render props.children?.()}
