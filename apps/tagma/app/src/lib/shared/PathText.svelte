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
  const yieldAt = $derived(directory === 'before' ? 'start' : 'end');
</script>

{#snippet part(from: number, to: number)}{#if piece}{@render piece(from, to)}{:else}{path.slice(from, to)}{/if}{/snippet}

{#snippet folderText()}
  {#if onDirectory === undefined}
    <FadeText fade={yieldAt} data-yield={yieldAt} class={directoryClass}>{@render part(0, folderEnd)}</FadeText>
  {:else}
    <button type="button" data-yield={yieldAt} class={cn('min-w-0 text-left', directoryClass)} title={directoryTitle} onclick={onDirectory}>
      <FadeText fade={yieldAt}>{@render part(0, folderEnd)}</FadeText>
    </button>
  {/if}
{/snippet}

<span {...rest} data-line class={cn('items-baseline', directory === 'after' && 'gap-1', className)}>
  {#if directory === 'before' && folderEnd > 0}{@render folderText()}{/if}
  <FadeText class={nameClass}>{@render part(cut + 1, path.length)}{suffix}</FadeText>
  {#if directory === 'after' && folderEnd > 0}{@render folderText()}{/if}
</span>
