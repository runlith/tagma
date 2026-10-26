<script lang="ts">
  import Waiting from '@runlith/chat-ui/Waiting.svelte';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import { diffParam } from '$lib/features/workspace/address.js';
  import { Addresses } from '$lib/features/workspace/Addresses.js';
  import BlockDiffCard from '$lib/features/graph/BlockDiffCard.svelte';
  import TagIcon from '$lib/features/graph/TagIcon.svelte';
  import ScopeChip from '$lib/features/graph/ScopeChip.svelte';
  import { opWords } from '$lib/features/graph/journal/actions.js';
  import Author from '$lib/features/graph/journal/Author.svelte';
  import Filters from '$lib/features/graph/journal/Filters.svelte';
  import { batchKey, clockOf, runRange } from '$lib/features/graph/journal/rows.js';
  import type { JournalScreen } from '$lib/features/graph/journal/Screen.svelte.js';
  import { TagCatalog } from '$lib/features/graph/TagCatalog.svelte.js';
  import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
  import { cn } from '$lib/shared/utils.js';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import PageHeader from '$lib/shared/PageHeader.svelte';

  let { journal, scope }: { journal: JournalScreen; scope: string | null } = $props();

  const tags = TagCatalog.use();
  const workspace = Workspace.use();
  const addresses = Addresses.use();

  const caption = $derived(
    `What was written to the ${workspace.contextProject?.name ?? 'project'} graph · ${journal.entries}${journal.cursor === null ? '' : '+'} ${journal.entries === 1 ? 'entry' : 'entries'}`,
  );

  let sentinel = $state<HTMLElement | null>(null);
  let sentinelVisible = $state(false);
  $effect(() => {
    const el = sentinel;
    if (!el) return;
    const observer = new IntersectionObserver((hits) => {
      sentinelVisible = hits.some((hit) => hit.isIntersecting);
    });
    observer.observe(el);
    return () => observer.disconnect();
  });
  $effect(() => {
    if (sentinelVisible && journal.loaded && journal.cursor !== null) void journal.readOlder();
  });
</script>

{#snippet scopeChip()}
  {#if scope !== null}<ScopeChip name={scope} block={journal.blocks.get(scope)} surface="journal" />{/if}
{/snippet}

{#snippet filters()}
  <Filters {journal} />
{/snippet}

<div class="page-wide pt-8 pb-16">
  <PageHeader title="Journal" {caption} actions={filters} scope={scope === null ? undefined : scopeChip} class="mb-6" />

  {#if journal.rows.length > 0}
    <div class="grid grid-cols-1">
      {#each journal.rows as row (row.key)}
        {#if row.kind === 'day'}
          <h2 class="eyebrow mt-4 mb-1 px-2 text-muted-foreground first:mt-0">{row.label}</h2>
        {:else}
          {@const block = journal.blocks.get(row.blockName)}
          {@const unread = row.lastEventId > journal.sessionMark}
          {@const open = journal.openRuns.has(row.key)}
          {@const words = opWords(row.ops)}
          <div class={cn('rounded-md transition-colors', open ? 'bg-selected' : 'hover:bg-hover')}>
            <div class="flex min-h-7 min-w-0 items-center gap-3 px-2">
              <Tooltip text={open ? 'Hide what changed' : 'Show what changed'}>
                <button
                  type="button"
                  class="grid size-4 shrink-0 place-items-center rounded-sm text-muted-foreground transition-colors hover:text-foreground"
                  onclick={() => journal.toggleRun(row)}
                  aria-expanded={open}
                  aria-label={open ? 'Hide what changed' : 'Show what changed'}
                >
                  <ChevronRight class={cn('size-3.5 transition-transform duration-150 ease-instrument', open && 'rotate-90')} />
                </button>
              </Tooltip>
              <Tooltip
                text={`${new Date(row.firstTs).toLocaleString()}${row.entries > 1 ? ` — ${new Date(row.lastTs).toLocaleString()}` : ''}`}
              >
                <span class={cn('w-10 shrink-0 stamp tabular', unread ? 'font-medium text-foreground' : 'text-muted-foreground')}>
                  {clockOf(row.lastTs)}
                </span>
              </Tooltip>
              <Author session={journal.sessionOf(row.sessionId)} class="w-40 shrink-0" />
              <Tooltip text={words} class="flex w-56 shrink-0 items-baseline gap-1.5">
                <span class="min-w-0 truncate text-ui text-muted-foreground">{words}</span>
                {#if row.entries > 1}
                  <span class="stamp tabular shrink-0 text-muted-foreground">×{row.entries}</span>
                {/if}
              </Tooltip>
              <a href={addresses.block(row.blockName, { diff: diffParam(runRange(row)) })} class="flex min-w-0 flex-1 items-center gap-2">
                {#if block}
                  <span class="size-1.5 shrink-0 rounded-full" style:background={tags.statusVar(block)}></span>
                  <TagIcon tag={tags.tagOf(block)} class="size-3.5 shrink-0 text-muted-foreground" />
                {/if}
                <Tooltip text={block?.deletedAt != null ? 'In the trash' : undefined} class="block min-w-0 flex-1">
                  <span
                    class={cn(
                      'block min-w-0 truncate text-ui',
                      unread ? 'text-foreground' : 'text-muted-foreground',
                      block?.deletedAt != null && 'line-through decoration-muted-foreground/40',
                    )}
                  >
                    {block?.title.trim() || `L-${row.blockName}`}
                  </span>
                </Tooltip>
              </a>
            </div>

            {#if open}
              <div class="ml-6 grid gap-3 border-l-2 border-brand/50 pt-1 pr-2 pb-3 pl-4">
                {#each row.batches as batch (batchKey(batch))}
                  {@const opened = journal.diffs.get(batchKey(batch))}
                  {#if opened}
                    <BlockDiffCard diff={opened.diff} marks={opened.marks} blocks={opened.blocks} />
                  {:else}
                    <span class="flex items-center gap-2 text-small text-muted-foreground">
                      <Waiting class="size-3" />
                      Reading the journal back…
                    </span>
                  {/if}
                {/each}
              </div>
            {/if}
          </div>
        {/if}
      {/each}
    </div>
  {:else if journal.loaded && journal.cursor === null}
    <p class="text-ui text-muted-foreground">
      {journal.filtered ? 'Nothing here matches the filter.' : 'Nothing has been written here yet.'}
    </p>
  {/if}

  {#if journal.cursor !== null}
    <div bind:this={sentinel} class="grid h-10 place-items-center">
      <Waiting class="size-4 text-muted-foreground" />
    </div>
  {/if}
</div>
