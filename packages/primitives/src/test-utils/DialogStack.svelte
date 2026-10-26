<script lang="ts">
  import type { MountedApp } from '@runlith/layer/App';
  import { App } from '@runlith/layer/svelte/App.svelte';
  import { untrack } from 'svelte';
  import DialogHost from '../DialogHost.svelte';

  const { app }: { app: MountedApp } = $props();
  untrack(() => App.attach(app));
</script>

<DialogHost motion={{ content: { durationMs: 0 }, overlay: { durationMs: 0 } }} />
