<script lang="ts">
  import { Layer } from '../../Layer.js';
  import { App as Core } from '../../App.js';
  import { Visitor } from '../../testing.js';
  import { App } from '../App.svelte.js';
  import { Boot } from './flagged-fixtures.svelte.js';

  let { boot }: { boot: Boot } = $props();

  App.mount(
    Core.define(
      Layer.mergeAll(
        Layer.when(
          () => boot.data.feature,
          () => import('./flagged-chunk.js'),
        ),
        Layer.of(Boot, boot),
        Visitor.of(() => Visitor.guest()),
      ),
      { data: 'lazy', ladder: [Visitor] },
    ),
  );
</script>

<p data-testid="flag">{boot.data.feature ? 'on' : 'off'}</p>
