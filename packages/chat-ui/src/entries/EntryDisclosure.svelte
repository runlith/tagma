<script lang="ts">
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import type { Snippet } from 'svelte';
  import { slide } from 'svelte/transition';
  import { messageTime } from '../chatTime';
  import { useChatStrings } from '../strings';

  type Props = {
    label: string;
    mono?: boolean;
    occurredAt?: string;
    text: string;
    open: boolean;
    onToggle(): void;
    body?: Snippet;
  };

  let { label, mono = false, occurredAt, text, open, onToggle, body }: Props = $props();
  const strings = useChatStrings();
</script>

<div class="mr-auto w-full min-w-0 max-w-feed">
  <button
    type="button"
    class="flex cursor-pointer items-center gap-1.5 text-small text-muted-foreground/70 transition hover:text-muted-foreground"
    aria-expanded={open}
    onclick={onToggle}
  >
    <ChevronRight class={`size-3 shrink-0 transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
    <span class={mono ? 'font-mono' : undefined}>{label}</span>
    {#if occurredAt}<span class="text-muted-foreground/50">{messageTime(occurredAt, strings.locale)}</span>{/if}
  </button>
  {#if open}
    <div transition:slide={{ duration: 160 }}>
      {#if body}
        <div class="mt-2 max-h-80 overflow-auto rounded-lg border border-border/60 bg-background/60 px-3 py-2">
          {@render body()}
        </div>
      {:else}
        <pre
          class="mt-2 max-h-80 overflow-auto rounded-lg border border-border/60 bg-background/60 p-3 text-small leading-5 whitespace-pre-wrap text-muted-foreground">{text}</pre>
      {/if}
    </div>
  {/if}
</div>
