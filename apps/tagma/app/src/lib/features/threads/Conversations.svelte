<script lang="ts">
  import { stemsOf } from '@runlith/search-text/highlight';
  import { Refusal } from '$lib/wire/refusal.js';
  import ConversationHit from './ConversationHit.svelte';
  import { ThreadsRepo } from './Repo.js';

  type Found = NonNullable<ReturnType<ThreadsRepo['conversations']['key']>['data']>;

  let { query, projectId }: { query: string; projectId: number } = $props();

  const repo = ThreadsRepo.use();

  const needle = $derived(query.trim());
  const search = $derived(needle === '' ? null : repo.conversations.key({ projectId, query: needle }));
  const stems = $derived(stemsOf(needle));
  const tooShort = $derived(search?.error instanceof Refusal && search.error.code === 'query-too-short');

  let held = $state.raw<Found | null>(null);
  $effect(() => {
    const data = search?.data;
    if (data !== undefined) held = data;
    else if (search === null) held = null;
  });
  const found = $derived(search?.data ?? (search?.error === undefined ? held : null));

  $effect(() => {
    const asked = search;
    return () => void asked?.cancel();
  });

  let opened = $state<{ readonly of: string; readonly threadId: string } | null>(null);
  const scopeKey = $derived(`${projectId}:${needle}`);
  const openId = $derived(opened?.of === scopeKey ? opened.threadId : null);

  const count = $derived.by(() => {
    if (found === null) return null;
    if (found.total !== null) return String(found.total);
    return found.atLeast === undefined ? null : `${found.atLeast}+`;
  });
</script>

{#if needle !== '' && !tooShort}
  <div class="mt-1.5 grid gap-px" data-conversations>
    <div class="flex items-center gap-1.5 px-1.5 py-1 text-small text-muted-foreground">
      <span class="eyebrow">In conversations</span>
      {#if found === null && search?.error === undefined}
        <span class="ml-auto">Searching…</span>
      {:else if count !== null}
        <span class="tabular ml-auto">{count}</span>
      {/if}
    </div>
    {#if found !== null}
      <div class={['grid gap-px transition-opacity', search?.isFetching && 'opacity-60']}>
        {#each found.matches as hit (hit.threadId)}
          <ConversationHit
            {hit}
            {stems}
            {projectId}
            open={openId === hit.threadId}
            onToggle={() => (opened = openId === hit.threadId ? null : { of: scopeKey, threadId: hit.threadId })}
          />
        {/each}
      </div>
      {#if found.matches.length === 0}
        <p class="px-2 py-1 text-small text-muted-foreground">
          {found.coverage.complete ? 'No conversation says this.' : 'No match so far.'}
        </p>
      {:else if found.approximate === true}
        <p class="px-2 py-1 text-small text-muted-foreground" data-conversations-approximate>
          Nothing matches as typed; showing close spellings.
        </p>
      {/if}
      {#if !found.coverage.complete}
        <p class="px-2 py-1 text-small text-muted-foreground" data-conversations-unread={found.coverage.unindexed}>
          {found.coverage.unindexed}
          {found.coverage.unindexed === 1 ? 'thread is' : 'threads are'} not read yet, so there may be more.
        </p>
      {/if}
    {:else if search?.error !== undefined}
      <p class="px-2 py-1 text-small text-muted-foreground">Could not search the conversations.</p>
    {/if}
  </div>
{/if}
