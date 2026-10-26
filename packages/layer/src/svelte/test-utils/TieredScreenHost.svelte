<script lang="ts">
  import { untrack } from 'svelte';

  import type { Definition } from '../../App.js';
  import { App } from '../App.svelte.js';
  import Probe from './Probe.svelte';
  import { page } from './screen-tier-fixtures.svelte.js';

  type Props = { definition: Definition; run: () => void; page?: () => void };
  const props: Props = $props();

  untrack(() => {
    App.mount(props.definition);
    props.run();
  });
</script>

{#if props.page && page.open}
  <Probe run={props.page} />
{/if}
