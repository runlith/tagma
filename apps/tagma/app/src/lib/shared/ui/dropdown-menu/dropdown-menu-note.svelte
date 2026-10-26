<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import FadeText from '$lib/shared/FadeText.svelte';
  import { cn } from '$lib/shared/utils.js';

  let {
    text,
    tone = 'muted',
    class: className,
    children,
    ...rest
  }: Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
    text?: string;
    tone?: 'muted' | 'destructive';
    children?: Snippet;
  } = $props();
</script>

<div
  title={text}
  {...rest}
  data-slot="dropdown-menu-note"
  class={cn(
    'flex min-h-7 items-center gap-2 px-2 py-1 text-small',
    tone === 'destructive' ? 'text-destructive' : 'text-muted-foreground',
    className,
  )}
>
  <span class="size-3.5 shrink-0" aria-hidden="true"></span>
  <FadeText class="flex-1"
    >{#if children}{@render children()}{:else}{text}{/if}</FadeText
  >
</div>
