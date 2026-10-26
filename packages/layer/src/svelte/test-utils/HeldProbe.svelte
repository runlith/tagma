<script lang="ts">
  import type { Scope } from '../../Scope.js';
  import type { AnyRung } from '../../Rung.js';
  import type { KeyClass } from '../../key.js';
  import type { Definition } from '../../App.js';
  import { App } from '../App.svelte.js';
  import HeldPane from './HeldPane.svelte';

  type Pane = { rung: AnyRung; input: object; read: KeyClass<string, { scope: Scope }> };
  type Props = {
    definition: Definition;
    panes: Pane[];
    onScope: (index: number, held: Scope, read: Scope, screen: Scope) => void;
  };

  const props: Props = $props();

  App.mount(props.definition);
</script>

{#each props.panes as pane, index (index)}
  <HeldPane
    rung={pane.rung}
    input={pane.input}
    read={pane.read}
    onScope={(held, read, screen) => props.onScope(index, held, read, screen)}
  />
{/each}
