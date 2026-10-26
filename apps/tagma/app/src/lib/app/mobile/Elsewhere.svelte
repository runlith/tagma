<script lang="ts">
  import Monitor from '@lucide/svelte/icons/monitor';
  import { Platform } from '@runlith/layer/Platform';
  import { Router } from '@runlith/layer/Router';
  import { machineName } from '$lib/features/shell/machine.js';
  import { Addresses } from '$lib/features/workspace/Addresses.js';
  import Header from './Header.svelte';

  const router = Router.use();
  const addresses = Addresses.use();
  const machine = machineName(Platform.use().storage.local);
  const project = $derived(router.params.project ?? '');
</script>

<Header title={project} parent={addresses.thread(null, project)} />
<div class="grid flex-1 place-items-center px-8">
  <div class="grid max-w-xs justify-items-center gap-3 text-center">
    <Monitor class="size-4 text-muted-foreground" />
    <p class="text-body text-muted-foreground">Open Tagma on {machine} to see this.</p>
    <a class="flex min-h-11 items-center px-4 text-body font-medium text-primary" href={addresses.thread(null, project)}> Go to agents </a>
  </div>
</div>
