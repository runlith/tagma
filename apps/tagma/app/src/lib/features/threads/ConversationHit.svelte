<script lang="ts">
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import type { ConversationHit } from '@tagma/server/threads/contract/wire/conversation';
  import { Addresses } from '$lib/features/workspace/Addresses.js';
  import { snippetOf } from '@runlith/search-text/highlight';
  import { timeCompact } from '$lib/shared/time.js';
  import { Button } from '$lib/shared/ui/button/index.js';
  import { conversationLabel } from './conversationLabel.js';
  import { ThreadsRepo } from './Repo.js';
  import Spans from '$lib/shared/Spans.svelte';
  import FadeText from '$lib/shared/FadeText.svelte';

  const WINDOW_TEXT = 400;

  let {
    hit,
    stems,
    projectId,
    open,
    onToggle,
  }: {
    hit: ConversationHit;
    stems: readonly string[];
    projectId: number;
    open: boolean;
    onToggle: () => void;
  } = $props();

  const repo = ThreadsRepo.use();
  const addresses = Addresses.use();

  const label = $derived(conversationLabel(hit));
  const elsewhere = $derived(hit.project !== null && hit.project.id !== projectId ? hit.project : null);
  const href = $derived(addresses.thread(hit.threadId, elsewhere === null ? undefined : elsewhere.name));
  const around = $derived(
    open
      ? repo.conversationWindow.key({ projectId: hit.project?.id ?? projectId, threadId: hit.threadId, entryId: hit.match.entryId })
      : null,
  );
  const spoken = $derived(around?.data?.[0]);
</script>

<button
  type="button"
  class="grid w-full min-w-0 grid-cols-[0.875rem_minmax(0,1fr)_auto] items-start gap-x-1.5 rounded-md py-1 pr-2 pl-1.5 text-left text-ui text-foreground/85 transition-colors hover:bg-hover focus-visible:bg-selected focus-visible:outline-none focus-visible:inset-ring-1 focus-visible:inset-ring-ring"
  aria-expanded={open}
  data-fold="hit"
  data-conversation-hit={hit.threadId}
  onclick={onToggle}
>
  <ChevronRight class={['mt-0.5 size-3.5 text-muted-foreground transition-transform', open && 'rotate-90']} />
  <FadeText class="leading-[18px]" text={label} />
  <span class="tabular text-meta leading-[18px] text-muted-foreground" data-conversation-time>{timeCompact(hit.match.occurredAt)}</span>
  {#if elsewhere !== null || hit.archived}
    <span data-line class="col-span-2 col-start-2 items-center gap-1.5 text-small text-muted-foreground/80">
      {#if elsewhere !== null}<FadeText class="font-mono" text={elsewhere.name} data-conversation-project />{/if}
      {#if hit.archived}<span class="eyebrow">Archived</span>{/if}
    </span>
  {/if}
  <span class="col-span-2 col-start-2 line-clamp-2 text-small leading-[16px] text-muted-foreground">
    <Spans text={hit.match.snippet} spans={hit.match.highlights} />
  </span>
</button>

{#if open}
  <div class="mb-1 ml-3 grid gap-px border-l border-vein pl-2" data-conversation-window>
    {#if spoken !== undefined && 'messages' in spoken}
      {#each spoken.messages as message (message.entryId)}
        {@const shown = snippetOf(message.text, stems, WINDOW_TEXT)}
        <div
          class={['grid gap-0.5 rounded-md px-1.5 py-1', message.entryId === hit.match.entryId && 'bg-selected']}
          data-conversation-message={message.entryId === hit.match.entryId ? 'match' : 'near'}
        >
          <span class="flex items-center gap-1.5 text-small leading-[14px] text-muted-foreground">
            <span class="font-medium">{message.role === 'operator' ? 'You' : 'Agent'}</span>
            <span class="tabular">{timeCompact(message.occurredAt)}</span>
          </span>
          <p class="line-clamp-4 text-small leading-[16px] break-words whitespace-pre-wrap text-foreground/85">
            {#if !message.text.startsWith(shown.snippet)}…{/if}<Spans
              text={shown.snippet}
              spans={shown.highlights}
            />{#if !message.text.endsWith(shown.snippet)}…{/if}
          </p>
        </div>
      {/each}
    {:else if spoken !== undefined}
      <p class="px-1.5 py-1 text-small text-muted-foreground">This message is no longer in the thread.</p>
    {:else if around?.error !== undefined}
      <p class="px-1.5 py-1 text-small text-muted-foreground">Could not read this conversation.</p>
    {:else}
      <p class="px-1.5 py-1 text-small text-muted-foreground">Reading…</p>
    {/if}
    <div class="flex justify-end px-1.5 py-1">
      <Button {href} variant="secondary" size="xs" data-conversation-open>Open thread</Button>
    </div>
  </div>
{/if}
