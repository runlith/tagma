<script lang="ts">
  import Plus from '@lucide/svelte/icons/plus';
  import type { ServedSettings } from '@tagma/server/providers/contract/wire/catalog';
  import { Button } from '$lib/shared/ui/button/index.js';
  import InstanceCard from './InstanceCard.svelte';

  let { settings }: { settings: ServedSettings } = $props();

  let adding = $state(false);
</script>

<section class="grid gap-2" aria-label={settings.title} data-adapter-settings={settings.adapter}>
  <div class="flex items-center gap-2">
    <h3 class="flex-1 text-ui font-semibold">{settings.title}</h3>
    {#if !adding}
      <Button variant="outline" size="sm" onclick={() => (adding = true)}>
        <Plus class="size-3.5" />
        Add {settings.instance}
      </Button>
    {/if}
  </div>
  {#each settings.instances as instance (instance.id)}
    <InstanceCard {settings} {instance} />
  {/each}
  {#if adding}
    <InstanceCard {settings} instance={null} onclose={() => (adding = false)} />
  {/if}
</section>
