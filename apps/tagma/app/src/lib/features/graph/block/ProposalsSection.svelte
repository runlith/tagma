<script lang="ts">
  import type { AmendmentOp } from '@tagma/server/graph/contract/wire/batch';
  import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
  import Check from '@lucide/svelte/icons/check';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import CircleCheck from '@lucide/svelte/icons/circle-check';
  import X from '@lucide/svelte/icons/x';
  import { SvelteMap, SvelteSet } from 'svelte/reactivity';
  import { Addresses } from '$lib/features/workspace/Addresses.js';
  import type { BlockRead, TreeBlock } from '@tagma/server/graph/contract/wire/rows';
  import { AMENDMENT } from '@tagma/server/graph/contract/wire/tags/amendment';
  import { BlockTitles } from '$lib/features/graph/BlockTitles.svelte.js';
  import { CommitLinks } from '$lib/features/checkout/CommitLinks.svelte.js';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import MarkdownBody from '$lib/features/graph/MarkdownBody.svelte';
  import StatusChip from '$lib/features/graph/StatusChip.svelte';
  import WriterBadge from '$lib/features/graph/WriterBadge.svelte';
  import { Notices } from '$lib/features/notices/Service.svelte.js';
  import { BlocksRepo } from '$lib/features/graph/BlocksRepo.js';
  import { GraphFeed } from '$lib/features/graph/Feed.js';
  import { SessionRegistry } from '$lib/features/graph/SessionRegistry.svelte.js';
  import { TagCatalog } from '$lib/features/graph/TagCatalog.svelte.js';
  import type { TreeScreen } from '$lib/features/graph/TreeScreen.svelte.js';
  import { cn } from '$lib/shared/utils.js';

  const blockTitles = BlockTitles.use();
  const commitLinks = CommitLinks.use();
  const notices = Notices.use();
  const sessions = SessionRegistry.use();
  const blocks = BlocksRepo.use();
  const feed = GraphFeed.use();
  const tags = TagCatalog.use();
  const addresses = Addresses.use();

  let { read, store }: { read: BlockRead; store: TreeScreen } = $props();

  type Row = { name: string; author: number | null; block: TreeBlock };

  const rows = $derived.by(() => {
    const out: Row[] = [];
    for (const edge of read.edgesIn) {
      if (edge.kind !== 'amends') continue;
      const block = store.block(edge.fromName);
      if (block !== undefined && tags.supports(block, AMENDMENT)) out.push({ name: edge.fromName, author: edge.createdBySessionId, block });
    }
    return out.sort((a, b) => b.block.createdAt.localeCompare(a.block.createdAt));
  });

  const pending = $derived(rows.filter((item) => !tags.isTerminal(item.block)));
  const decided = $derived(rows.filter((item) => tags.isTerminal(item.block)));
  let historyOpen = $state(false);
  const visible = $derived(historyOpen ? [...pending, ...decided] : pending);

  const decidedLabel = $derived.by(() => {
    const first = decided[0];
    const verdicts = first === undefined ? [] : tags.verdictsOf(first.block);
    return verdicts
      .flatMap((verdict) => {
        const count = decided.filter((item) => tags.statusOf(item.block) === verdict).length;
        return count > 0 ? [`${count} ${verdict}`] : [];
      })
      .join(' · ');
  });

  const expanded = new SvelteSet<string>();
  const details = new SvelteMap<string, BlockRead>();

  $effect(() =>
    feed.frames((frame) => {
      if (frame.type !== 'change') return;
      for (const entry of frame.events) {
        if (entry.blockName === null || !details.has(entry.blockName)) continue;
        details.delete(entry.blockName);
        if (expanded.has(entry.blockName)) void reread(entry.blockName);
      }
    }),
  );

  function readOne(name: string): Promise<BlockRead | undefined> {
    return blocks.block.key({ name, depth: 0 }).refresh({ throwOnError: true });
  }

  function reread(name: string): void {
    void readOne(name)
      .then((full) => {
        if (full) details.set(name, full);
      })
      .catch((error: unknown) => notices.refusal(error));
  }

  function keep(name: string, full: BlockRead | undefined): void {
    if (full) details.set(name, full);
  }

  function toggle(name: string): void {
    if (expanded.has(name)) {
      expanded.delete(name);
      return;
    }
    expanded.add(name);
    if (details.has(name)) return;
    reread(name);
  }

  function amendmentOps(name: string): readonly AmendmentOp[] {
    const detail = details.get(name);
    return detail === undefined ? [] : tags.opsOf(detail);
  }

  function nameOf(ref: string | undefined): string {
    if (ref === undefined) return '';
    return store.block(ref)?.title.trim() || ref;
  }

  let rejecting = $state<string | null>(null);
  let upholding = $state<string | null>(null);
  let reason = $state('');
  let answeredBy = $state('');

  async function accept(name: string): Promise<void> {
    try {
      await blocks.accept.run({ name }, { throwOnError: true });
      keep(name, await readOne(name));
    } catch (error) {
      notices.refusal(error);
    }
  }

  async function reject(name: string): Promise<void> {
    try {
      await blocks.reject.run({ name, reason }, { throwOnError: true });
      rejecting = null;
      reason = '';
      keep(name, await readOne(name));
    } catch (error) {
      notices.refusal(error);
    }
  }

  async function uphold(name: string): Promise<void> {
    try {
      await blocks.uphold.run({ name, reason, by: answers() }, { throwOnError: true });
      upholding = null;
      reason = '';
      answeredBy = '';
      keep(name, await readOne(name));
    } catch (error) {
      notices.refusal(error);
    }
  }

  function answers(): string[] {
    return answeredBy.split(/[\s,]+/).filter(Boolean);
  }
</script>

{#if rows.length > 0}
  <section class="mt-8 border-t border-vein pt-2">
    <div class="flex items-center gap-3">
      <h2 class="eyebrow text-muted-foreground">Proposals</h2>
      {#if decided.length > 0}
        <button
          type="button"
          class="ml-auto flex items-center gap-1.5 rounded-lg px-1.5 py-0.5 text-small text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
          onclick={() => (historyOpen = !historyOpen)}
          aria-expanded={historyOpen}
        >
          {decidedLabel}
          <ChevronRight class={cn('size-3.5 transition-transform duration-150 ease-instrument', historyOpen && 'rotate-90')} />
        </button>
      {/if}
    </div>
    <div class="mt-2 grid gap-1">
      {#each visible as item (item.name)}
        {@const open = !tags.isTerminal(item.block)}
        <div class={cn('min-w-0 rounded-lg', expanded.has(item.name) && 'bg-selected')}>
          <div class="flex min-w-0 items-center gap-2 rounded-lg px-2 transition-colors hover:bg-hover">
            <button
              type="button"
              class="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left"
              onclick={() => toggle(item.name)}
              aria-expanded={expanded.has(item.name)}
            >
              <ChevronRight
                class={cn(
                  'size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 ease-instrument',
                  expanded.has(item.name) && 'rotate-90',
                )}
              />
              <span class={cn('min-w-0 flex-1 truncate text-ui', !open && 'text-muted-foreground')}>
                {item.block.title.trim() || 'Untitled'}
              </span>
            </button>
            <WriterBadge writer={sessions.writerOf(item.author)} />
            <StatusChip block={item.block} />
            <Tooltip text="Open the proposal">
              <a
                href={addresses.block(item.name)}
                data-block={item.name}
                class="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
                aria-label="Open the proposal"
              >
                <ArrowUpRight class="size-3.5" />
              </a>
            </Tooltip>
          </div>

          {#if expanded.has(item.name)}
            <div class="grid gap-2 px-3 pt-1 pb-2">
              {#each amendmentOps(item.name) as op, index (index)}
                <div class="min-w-0 text-small">
                  {#if op.op === 'edit'}
                    <div class="text-muted-foreground/80">edits {nameOf(op.id)}</div>
                    <div class="amend mt-1 text-severity-lie/90 line-through decoration-severity-lie/40">
                      <MarkdownBody text={op.old} refs={blockTitles} commits={commitLinks} />
                    </div>
                    <div class="amend mt-0.5 text-status-done">
                      <MarkdownBody text={op.new} refs={blockTitles} commits={commitLinks} />
                    </div>
                  {:else if op.op === 'create'}
                    <div class="text-muted-foreground/80">
                      adds {(op.tags ?? []).map((tag) => `#${tag}`).join(' ') || 'a note'} under
                      {nameOf(op.parentId) || 'the root'}
                    </div>
                    <div class="mt-1 text-ui text-status-done">{op.title}</div>
                    {#if op.body}
                      <div class="amend mt-0.5 text-status-done/90">
                        <MarkdownBody text={op.body} refs={blockTitles} commits={commitLinks} />
                      </div>
                    {/if}
                  {:else if op.op === 'update'}
                    <div class="text-muted-foreground/80">rewrites {nameOf(op.id)}</div>
                    {#if op.title !== undefined}<div class="mt-1 text-ui text-status-done">{op.title}</div>{/if}
                    {#if op.body !== undefined}
                      <div class="amend mt-0.5 text-status-done/90">
                        <MarkdownBody text={op.body} refs={blockTitles} commits={commitLinks} />
                      </div>
                    {/if}
                  {:else if op.op === 'delete'}
                    <div class="text-severity-lie/90">removes {nameOf(op.id)}</div>
                  {:else}
                    <div class={op.op === 'link' ? 'text-status-done/90' : 'text-severity-lie/90'}>
                      {op.op === 'link' ? 'links' : 'unlinks'}
                      {nameOf(op.fromId)} — {op.kind} — {nameOf(op.toId)}
                    </div>
                  {/if}
                </div>
              {/each}

              {#if details.get(item.name)?.sources.length}
                <div class="border-t border-vein pt-2 text-small text-muted-foreground">
                  {#each details.get(item.name)?.sources ?? [] as source (source.id)}
                    <div class="diff">{source.ref}{source.symbol ? `#${source.symbol}` : ''}</div>
                  {/each}
                </div>
              {/if}

              {#if (details.get(item.name)?.body ?? '').trim()}
                <div class="border-t border-vein pt-2">
                  <MarkdownBody
                    text={details.get(item.name)?.body ?? ''}
                    refs={blockTitles}
                    commits={commitLinks}
                    class="text-muted-foreground"
                  />
                </div>
              {/if}

              {#if !open}
                {@const verdict = details.get(item.name)?.verdict}
                {#if verdict}
                  <div class="border-t border-vein pt-2 text-small text-muted-foreground">
                    {verdict.status} by {#if verdict.writer === null}the operator{:else}<WriterBadge
                        writer={verdict.writer}
                      />{/if}{verdict.reason ? ` — ${verdict.reason}` : ''}{verdict.by.length === 0
                      ? ''
                      : ` — answered by ${verdict.by.join(', ')}`}
                  </div>
                {/if}
              {/if}

              {#if open}
                <div class="flex items-center gap-1.5 pt-0.5">
                  {#if rejecting === item.name}
                    <!-- svelte-ignore a11y_autofocus -->
                    <input
                      class="h-7 min-w-0 flex-1 rounded-lg border border-vein bg-transparent px-2 text-small outline-none focus:border-severity-lie/60"
                      placeholder="Why it is declined"
                      bind:value={reason}
                      autofocus
                      onkeydown={(event) => {
                        if (event.key === 'Enter' && reason.trim()) void reject(item.name);
                        if (event.key === 'Escape') rejecting = null;
                      }}
                    />
                    <button
                      type="button"
                      class="flex h-7 items-center gap-1.5 rounded-lg border border-severity-lie/30 px-3 text-small text-severity-lie transition-colors hover:bg-hover-danger disabled:opacity-50"
                      disabled={!reason.trim()}
                      onclick={() => void reject(item.name)}
                    >
                      <X class="size-3.5" />
                      Reject
                    </button>
                  {:else if upholding === item.name}
                    <!-- svelte-ignore a11y_autofocus -->
                    <input
                      class="h-7 min-w-0 flex-1 rounded-lg border border-vein bg-transparent px-2 text-small outline-none focus:border-status-done/60"
                      placeholder="Answered by (block names)"
                      bind:value={answeredBy}
                      autofocus
                      onkeydown={(event) => {
                        if (event.key === 'Escape') upholding = null;
                      }}
                    />
                    <input
                      class="h-7 min-w-0 flex-1 rounded-lg border border-vein bg-transparent px-2 text-small outline-none focus:border-status-done/60"
                      placeholder="Why its payload does not run"
                      bind:value={reason}
                      onkeydown={(event) => {
                        if (event.key === 'Enter' && reason.trim() && answers().length > 0) void uphold(item.name);
                        if (event.key === 'Escape') upholding = null;
                      }}
                    />
                    <button
                      type="button"
                      class="flex h-7 items-center gap-1.5 rounded-lg border border-status-done/30 px-3 text-small text-status-done transition-colors hover:bg-hover disabled:opacity-50"
                      disabled={!reason.trim() || answers().length === 0}
                      onclick={() => void uphold(item.name)}
                    >
                      <CircleCheck class="size-3.5" />
                      Uphold
                    </button>
                  {:else}
                    <button
                      type="button"
                      class="flex h-7 items-center gap-1.5 rounded-lg border border-status-done/30 px-3 text-small text-status-done transition-colors hover:bg-hover"
                      onclick={() => void accept(item.name)}
                    >
                      <Check class="size-3.5" />
                      Accept
                    </button>
                    <button
                      type="button"
                      class="flex h-7 items-center gap-1.5 rounded-lg px-3 text-small text-muted-foreground transition-colors hover:bg-hover hover:text-status-done"
                      onclick={() => {
                        upholding = item.name;
                        rejecting = null;
                        reason = '';
                        answeredBy = '';
                      }}
                    >
                      <CircleCheck class="size-3.5" />
                      Uphold
                    </button>
                    <button
                      type="button"
                      class="flex h-7 items-center gap-1.5 rounded-lg px-3 text-small text-muted-foreground transition-colors hover:bg-hover hover:text-severity-lie"
                      onclick={() => {
                        rejecting = item.name;
                        upholding = null;
                        reason = '';
                      }}
                    >
                      <X class="size-3.5" />
                      Reject
                    </button>
                  {/if}
                </div>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  </section>
{/if}

<style>
  .diff {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: var(--text-meta);
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .amend :global(h1),
  .amend :global(h2),
  .amend :global(h3),
  .amend :global(h4),
  .amend :global(h5),
  .amend :global(h6) {
    color: inherit;
  }
</style>
