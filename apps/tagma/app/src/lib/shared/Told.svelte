<script lang="ts">
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import { Button } from '$lib/shared/ui/button/index.js';
  import { cn } from '$lib/shared/utils.js';
  import { hasDetails, type Told } from '$lib/wire/told.js';
  import { actOf, SystemSettings } from './SystemSettings.js';
  import ToldDetails from './ToldDetails.svelte';

  let { told, detailsLabel = 'Details', class: className }: { told: Told; detailsLabel?: string; class?: string } = $props();

  const systemSettings = SystemSettings.find();

  let open = $state(false);

  const act = $derived(actOf(told, systemSettings));
  const detailed = $derived(hasDetails(told));
</script>

<div class={cn('grid min-w-0 gap-1.5', className)} data-told>
  {#if told.text !== ''}
    <p class="text-ui leading-snug break-words">{told.text}</p>
  {/if}
  {#if told.note !== undefined}
    <p class="text-small break-words text-muted-foreground">{told.note}</p>
  {/if}
  {#if act !== undefined || detailed}
    <div class="flex items-center gap-2">
      {#if act !== undefined}
        <Button variant="outline" size="xs" onclick={() => act.run()} data-told-act>{act.label}</Button>
      {/if}
      {#if detailed}
        <button
          type="button"
          class="inline-flex items-center gap-0.5 rounded-sm px-1 py-0.5 text-small text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
          aria-expanded={open}
          onclick={() => (open = !open)}
        >
          {detailsLabel}<ChevronRight class={cn('size-3 transition-transform', open && 'rotate-90')} />
        </button>
      {/if}
    </div>
    {#if open}
      <ToldDetails {told} class="px-1" />
    {/if}
  {/if}
</div>
