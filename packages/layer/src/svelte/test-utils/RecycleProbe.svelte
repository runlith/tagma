<script lang="ts">
  import { Layer } from '../../Layer.js';
  import { App as Core } from '../../App.js';
  import { Visitor, type VisitorInput } from '../../testing.js';
  import { App } from '../App.svelte.js';
  import { Profile, Teaser } from './fixtures.js';
  import GuestConsumer from './GuestConsumer.svelte';
  import UserConsumer from './UserConsumer.svelte';

  type Props = { session: VisitorInput };

  const props: Props = $props();

  App.mount(
    Core.define(
      Layer.mergeAll(
        Profile,
        Teaser,
        Visitor.of(() => props.session),
      ),
      { ladder: [Visitor] },
    ),
  );
  const isUser = $derived(props.session.kind === 'user');
</script>

{#key Visitor.keyOf(props.session)}
  {#if isUser}
    <UserConsumer />
  {:else}
    <GuestConsumer />
  {/if}
{/key}
