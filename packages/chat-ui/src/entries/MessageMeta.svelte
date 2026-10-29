<script lang="ts">
  import type { Snippet } from 'svelte';
  import { messageTime } from '../chatTime';
  import type { ChatMessageMetaExtra } from '../renderers';
  import { useChatStrings } from '../strings';

  type Props = {
    align: 'start' | 'end';
    copied: boolean;
    occurredAt?: string;
    onCopy?(): void;
    extra?: ChatMessageMetaExtra | null;
    actions?: Snippet;
  };

  let { align, copied, occurredAt, onCopy, extra = null, actions }: Props = $props();
  const strings = useChatStrings();
</script>

<div
  class={[
    'relative flex w-full items-center gap-1 pt-1 text-small text-muted-foreground/70 transition-[opacity,translate] duration-200 ease-out',
    'has-[[open]]:z-[130]',
    'opacity-0 -translate-y-0.5 group-hover/msg:translate-y-0 group-hover/msg:opacity-100 group-focus-within/msg:translate-y-0 group-focus-within/msg:opacity-100',
    '[@media(hover:none)]:translate-y-0 [@media(hover:none)]:opacity-100',
    align === 'end' && 'justify-end',
  ]}
>
  {#if occurredAt}<span class="px-0.5">{messageTime(occurredAt, strings.locale)}</span>{/if}
  {#if onCopy}
    <button
      type="button"
      class="grid size-6 cursor-pointer place-items-center rounded-md transition hover:bg-hover hover:text-foreground"
      title={strings.copy()}
      aria-label={strings.copyMessage()}
      onclick={onCopy}
    >
      {#if copied}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
          class="lucide-icon lucide lucide-check size-3.5 text-chat-success-mark"><path d="M20 6 9 17l-5-5" /></svg
        >
      {:else}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
          class="lucide-icon lucide lucide-copy size-3.5"
          ><rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path
            d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"
          /></svg
        >
      {/if}
    </button>
  {/if}
  {#if actions}{@render actions()}{/if}
  {#if extra}
    <details class="relative ml-auto min-w-0">
      <summary
        class="cursor-pointer list-none truncate px-0.5 font-mono text-meta tabular-nums text-muted-foreground/60 underline-offset-2 transition-colors hover:text-muted-foreground hover:underline [&::-webkit-details-marker]:hidden"
        >{extra.text}</summary
      >
      {#if extra.rows?.length}
        <div
          class="absolute right-0 bottom-[calc(100%+0.25rem)] z-[130] max-h-64 w-60 overflow-auto rounded-lg border border-border bg-popover p-2 font-mono text-meta text-popover-foreground shadow-raised"
        >
          {#each extra.rows as row (row.label)}
            <div class="flex items-center justify-between gap-4">
              <span class="truncate text-muted-foreground">{row.label}</span>
              <span class="shrink-0 tabular-nums">{row.value}</span>
            </div>
          {/each}
        </div>
      {/if}
    </details>
  {/if}
</div>
