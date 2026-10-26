<script lang="ts">
  import FileText from '@lucide/svelte/icons/file-text';
  import type { Snippet } from 'svelte';
  import { clipFade } from './clipFade';

  type Props = {
    name: string;
    href?: string;
    size?: 'row' | 'strip';
    children?: Snippet;
  };

  let { name, href, size = 'strip', children }: Props = $props();

  const shape = $derived([
    'flex min-w-0 items-center gap-1.5 border border-border',
    size === 'row' ? 'h-6 max-w-40 rounded-sm px-1.5 text-meta text-muted-foreground' : 'max-w-full rounded-lg bg-raised py-1 text-small',
    size === 'strip' && (children === undefined ? 'px-2' : 'pr-1 pl-2'),
  ]);
</script>

{#snippet body()}
  <FileText class="size-3.5 shrink-0 text-muted-foreground" />
  <span class={['min-w-0', size === 'strip' && 'max-w-64']} data-fade {@attach clipFade}>{name}</span>
  {@render children?.()}
{/snippet}

{#if href === undefined}
  <span class={shape} title={name}>{@render body()}</span>
{:else}
  <a {href} target="_blank" rel="noopener" class={[shape, 'transition-colors hover:bg-hover']} title={name}>{@render body()}</a>
{/if}
