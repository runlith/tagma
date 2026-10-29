<script lang="ts">
  import { Layer } from '../../Layer.js';
  import { App as Core } from '../../App.js';
  import { Visitor, type VisitorInput } from '../../testing.js';
  import { App } from '../App.svelte.js';
  import { Ledger, Machine, Player, Teaser } from './handoff-fixtures.svelte.js';
  import HandoffFrame from './HandoffFrame.svelte';

  type Props = { authed: boolean; search?: Layer<never, never>; awaits?: boolean };

  const props: Props = $props();

  const session = $derived<VisitorInput>(props.authed ? Visitor.user('7') : Visitor.guest());

  App.mount(
    Core.define(
      Layer.mergeAll(
        Machine,
        Player,
        Ledger,
        Teaser,
        props.search ?? Layer.mergeAll(),
        Visitor.of(() => session),
      ),
      {
        ladder: [Visitor],
      },
    ),
  );
</script>

{#key Visitor.keyOf(session)}
  <svelte:boundary>
    {#snippet failed(error)}<div data-testid="failed">{String(error)}</div>{/snippet}
    <HandoffFrame awaits={props.awaits === true && props.authed} />
  </svelte:boundary>
{/key}
