<script lang="ts">
  import Devices from '$lib/features/devices/Devices.svelte';
  import Choice from '$lib/features/shell/Choice.svelte';
  import Header from './Header.svelte';
  import Tabs from './Tabs.svelte';
</script>

<svelte:head><title>Settings</title></svelte:head>

<Header title="Settings" />

<div class="grid min-h-0 flex-1 content-start gap-8 overflow-y-auto overscroll-contain px-4 pt-4 pb-6">
  <section class="grid gap-2">
    <h2 class="text-small font-medium text-muted-foreground">Phone &amp; devices</h2>
    <Devices />
  </section>
  <section class="grid gap-2">
    <h2 class="text-small font-medium text-muted-foreground">Layout</h2>
    <Choice />
    <p class="text-small text-muted-foreground">Remembered by this browser. Choosing reloads the page.</p>
  </section>
</div>

<Tabs on="settings" />
