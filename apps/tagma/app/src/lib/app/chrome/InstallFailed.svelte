<script lang="ts">
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Callout from '@runlith/chat-ui/Callout.svelte';
  import type { Installed } from '@tagma/server/installation/contract/wire/next';
  import { Button } from '$lib/shared/ui/button/index.js';
  import { cn } from '$lib/shared/utils.js';
  import type { ThreadAddress } from '$lib/features/workspace/ShellOps.js';

  let {
    failed,
    title,
    retry,
    openThread,
  }: {
    failed: Installed;
    title: string;
    retry: (() => void) | undefined;
    openThread: ((thread: ThreadAddress) => void) | undefined;
  } = $props();

  const thread = $derived(failed.refused?.thread);

  let open = $state(false);
  let clipped = $state(false);

  const reason = $derived(failed.refused?.reason ?? failed.detail);
  const unblock = $derived(failed.refused?.unblock ?? []);
  const more = $derived(open || clipped || unblock.length > 0);
</script>

{#snippet actions()}
  {#if thread !== undefined && openThread !== undefined}
    <Button variant="outline" size="xs" onclick={() => openThread(thread)} data-install-thread={thread.threadId}>Open thread</Button>
  {/if}
  {#if retry !== undefined}
    <Button variant="outline" size="xs" onclick={retry} data-install-retry>Try again</Button>
  {/if}
  <Button variant="ghost" size="xs" onclick={() => void navigator.clipboard.writeText(failed.log)} data-install-log={failed.log}>
    Copy log path
  </Button>
  {#if more}
    <button
      type="button"
      class="inline-flex items-center gap-0.5 rounded-sm px-1 py-0.5 text-small text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
      aria-expanded={open}
      onclick={() => (open = !open)}
    >
      Show all<ChevronRight class={cn('size-3 transition-transform', open && 'rotate-90')} />
    </button>
  {/if}
{/snippet}

<Callout tone="error" {title} note={reason} clamp={!open} bind:clipped class="bg-background" {actions}>
  {#if open && unblock.length > 0}
    <ul class="grid min-w-0 gap-0.5 select-text" data-install-unblock>
      {#each unblock as line, index (index)}
        <li class="text-small wrap-anywhere text-muted-foreground">{line}</li>
      {/each}
    </ul>
  {/if}
</Callout>
