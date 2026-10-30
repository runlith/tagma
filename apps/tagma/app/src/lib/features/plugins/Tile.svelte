<script lang="ts">
  import { cn } from '$lib/shared/utils.js';

  let { title, size = 'md', class: className }: { title: string; size?: 'sm' | 'md' | 'lg'; class?: string } = $props();

  const letter = $derived((/[\p{L}\p{N}]/u.exec(title)?.[0] ?? '?').toUpperCase());
</script>

<span
  class={cn(
    'grid shrink-0 place-items-center border bg-raised font-semibold text-foreground select-none',
    size === 'sm' && 'size-4 rounded-sm text-meta',
    size === 'md' && 'size-8 rounded-md text-ui',
    size === 'lg' && 'size-12 rounded-lg text-title',
    className,
  )}
  aria-hidden="true">{letter}</span
>
