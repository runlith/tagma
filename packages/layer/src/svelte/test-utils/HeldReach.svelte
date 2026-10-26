<script lang="ts">
  import { untrack } from 'svelte';
  import type { Scope } from '../../Scope.js';
  import type { AnyRung } from '../../Rung.js';
  import type { KeyClass } from '../../key.js';
  import type { Definition } from '../../App.js';
  import { App } from '../App.svelte.js';

  type Props = {
    definition: Definition;
    rung: AnyRung;
    held: object;
    named: object;
    read: KeyClass<string, { scope: Scope }>;
    onRead: (home: string) => void;
  };

  const props: Props = $props();
  const { definition, rung, held, named: input, read, onRead } = untrack(() => ({ ...props }));

  App.mount(definition);
  App.hold(rung, held as never);
  const app = App.current();
  const named = app.hold(rung, input);
  onRead(app.resolve(read, named.scope).scope.home.name);
  $effect(() => () => named.release());
</script>
