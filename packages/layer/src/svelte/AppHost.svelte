<script lang="ts">
  import { untrack } from 'svelte';

  import type { MountedApp } from '../App.js';

  type Props = {
    create: () => MountedApp;
    onReady: (app: MountedApp) => void;
  };

  const props: Props = $props();

  untrack(() => props.onReady(props.create()));
</script>
