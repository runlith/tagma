<script lang="ts">
  import { clipFade } from '@runlith/chat-ui/clipFade';
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn } from './utils.js';

  let {
    text,
    children,
    fade = 'end',
    class: className,
    ...rest
  }: { text?: string; children?: Snippet; fade?: 'end' | 'start' } & Omit<HTMLAttributes<HTMLSpanElement>, 'children'> = $props();
</script>

<span {...rest} class={cn('block min-w-0', fade === 'start' && 'text-left', className)} data-fade={fade} {@attach clipFade}
  >{#if fade === 'start'}&lrm;{/if}{#if children}{@render children()}{:else}{text}{/if}{#if fade === 'start'}&lrm;{/if}</span
>
