<script lang="ts">
  import { cn } from '$lib/shared/utils.js';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';

  let { name, href, class: className, title }: { name: string; href?: string; class?: string; title?: string } = $props();

  const look = $derived(
    cn(
      'stamp tabular inline-flex shrink-0 items-center text-muted-foreground/70',
      href && 'transition-colors hover:text-foreground',
      className,
    ),
  );
</script>

{#if href}
  <Tooltip text={title}>
    <a {href} class={look} data-block={name}>{name}</a>
  </Tooltip>
{:else}
  <Tooltip text={title}>
    <span class={look}>{name}</span>
  </Tooltip>
{/if}
