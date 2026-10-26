<script lang="ts">
  import type { Scope } from '../../Scope.js';
  import type { AnyRung } from '../../Rung.js';
  import type { KeyClass } from '../../key.js';
  import { App } from '../App.svelte.js';
  import { Pane } from './held-fixtures.js';

  type Props = {
    rung: AnyRung;
    input: object;
    read: KeyClass<string, { scope: Scope }>;
    onScope: (held: Scope, read: Scope, screen: Scope) => void;
  };

  const props: Props = $props();

  const held = App.hold(props.rung, props.input as never);
  const instance = App.current().resolve(props.read);
  const pane = Pane.mount({});
  props.onScope(held, instance.scope.home, pane.scope);
</script>

<span data-held={held.name}></span>
