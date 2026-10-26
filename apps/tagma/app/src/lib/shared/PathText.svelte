<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import FadeText from './FadeText.svelte';
  import { cn } from './utils.js';

  let {
    path,
    suffix = '',
    directory = 'before',
    class: className,
    nameClass,
    directoryClass,
    onDirectory,
    directoryTitle,
    piece,
    ...rest
  }: {
    path: string;
    suffix?: string;
    directory?: 'before' | 'after' | 'none';
    nameClass?: string;
    directoryClass?: string;
    onDirectory?: (() => void) | undefined;
    directoryTitle?: string;
    piece?: Snippet<[from: number, to: number]>;
  } & Omit<HTMLAttributes<HTMLSpanElement>, 'children'> = $props();

  const cut = $derived(path.lastIndexOf('/'));
  const folderEnd = $derived(cut === -1 || directory === 'none' ? 0 : directory === 'before' ? cut + 1 : cut);
  const grow = $derived(directory === 'before' ? 'shrink' : 'flex-1');
</script>

{#snippet part(from: number, to: number)}{#if piece}{@render piece(from, to)}{:else}{path.slice(from, to)}{/if}{/snippet}

{#snippet folderText()}
  {#if onDirectory === undefined}
    <FadeText fade="start" class={cn(grow, directoryClass)}>{@render part(0, folderEnd)}</FadeText>
  {:else}
    <button type="button" class={cn('min-w-0 text-left', grow, directoryClass)} title={directoryTitle} onclick={onDirectory}>
      <FadeText fade="start">{@render part(0, folderEnd)}</FadeText>
    </button>
  {/if}
{/snippet}

<span {...rest} class={cn('flex min-w-0 items-baseline', directory === 'after' && 'gap-1', className)}>
  {#if directory === 'before' && folderEnd > 0}{@render folderText()}{/if}
  <FadeText class={cn('max-w-full shrink-0', nameClass)}>{@render part(cut + 1, path.length)}{suffix}</FadeText>
  {#if directory === 'after' && folderEnd > 0}{@render folderText()}{/if}
</span>
