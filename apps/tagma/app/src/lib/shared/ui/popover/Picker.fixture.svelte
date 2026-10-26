<script lang="ts">
  import type { HoverIntent } from '@runlith/primitives/popover.svelte';
  import Hold from './Hold.fixture.svelte';
  import * as Popover from './index.js';

  let { trapFocus, hover }: { trapFocus?: boolean; hover?: HoverIntent } = $props();

  let open = $state(false);
</script>

<button data-outside>Elsewhere</button>
<button data-reveal onclick={() => (open = true)}>Reveal</button>
<Popover.Root bind:open>
  <Popover.Trigger data-trigger {hover}>Pick</Popover.Trigger>
  <Popover.Content {trapFocus}>
    <button data-first>First</button>
    <input data-field />
    <Hold />
    <button data-last>Last</button>
  </Popover.Content>
</Popover.Root>
