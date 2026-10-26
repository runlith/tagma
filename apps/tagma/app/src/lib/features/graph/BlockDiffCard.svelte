<script lang="ts">
  import { Addresses } from '$lib/features/workspace/Addresses.js';
  import type { BlockDiff, BlockMark } from '@tagma/server/graph/contract/wire/reads';
  import type { Block } from '@tagma/server/graph/contract/wire/rows';
  import { BlockTitles } from '$lib/features/graph/BlockTitles.svelte.js';
  import { CommitLinks } from '$lib/features/checkout/CommitLinks.svelte.js';
  import type { GraphLens } from '$lib/features/workspace/GraphDoor.js';
  import BlockName from '$lib/features/graph/BlockName.svelte';
  import TagIcon from '$lib/features/graph/TagIcon.svelte';
  import MarkdownBody from '$lib/features/graph/MarkdownBody.svelte';
  import { CHANGE_TONE, MARK_LABEL, MARK_SIGN, MARK_TEXT } from '$lib/features/graph/diff.js';
  import { statusLabel, statusText } from '$lib/features/graph/status.js';
  import { TagCatalog } from '$lib/features/graph/TagCatalog.svelte.js';
  import { GraphRung } from '$lib/features/workspace/GraphRung.js';
  import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
  import { cn } from '$lib/shared/utils.js';
  import FadeText from '$lib/shared/FadeText.svelte';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';

  let {
    diff,
    body = '',
    marks = [],
    blocks = [],
    there,
  }: { diff: BlockDiff; body?: string; marks?: readonly BlockMark[]; blocks?: readonly Block[]; there?: GraphLens } = $props();

  const blockTitles = BlockTitles.use();
  const commitLinks = CommitLinks.use();
  const tags = TagCatalog.use();
  const aim = GraphRung.Current.use();
  const workspace = Workspace.use();
  const addresses = Addresses.use();
  const project = $derived(there?.project ?? workspace.find(aim.projectId)?.name ?? null);
  const branch = $derived(there === undefined ? aim.branch : (there.branch ?? null));
  const hrefOf = (name: string): string | undefined => (project === null ? undefined : addresses.block(name, { project, branch }));

  const rows = $derived(new Map(blocks.map((row) => [row.name, row])));
  const text = $derived(diff.body ?? body);
  const facts = $derived(diff.title !== null || diff.status !== null || diff.tag !== null || diff.changes.length > 0 || marks.length > 0);
  const silent = $derived(!facts && !diff.bodyUnknown && !text.trim());
</script>

<div class="diff-body">
  {#if text.trim()}
    <MarkdownBody {text} refs={blockTitles} commits={commitLinks} />
  {/if}

  {#if diff.bodyUnknown}
    <p class="mt-2 text-ui text-muted-foreground">
      The body was rewritten{#if diff.bodySize}
        <span class="stamp tabular"> ({diff.bodySize.from} → {diff.bodySize.to} characters)</span>
      {/if}, before this journal recorded how.
    </p>
  {/if}

  {#if facts}
    <div class="mt-3 grid gap-1.5 border-t border-vein pt-2">
      {#if diff.title}
        <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-ui">
          <span class="eyebrow shrink-0 text-muted-foreground">Title</span>
          <span class="text-severity-lie line-through decoration-severity-lie/50">{diff.title.from}</span>
          <span class="text-muted-foreground/60">→</span>
          <span class="text-status-done">{diff.title.to}</span>
        </div>
      {/if}

      {#if diff.tag || diff.status}
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-small">
          {#if diff.tag}
            <span class="eyebrow shrink-0 text-muted-foreground">Tag</span>
            <span class="text-muted-foreground">#{diff.tag.from}</span>
            <span class="text-muted-foreground/60">→</span>
            <span class="text-status-done">#{diff.tag.to}</span>
          {/if}
          {#if diff.status}
            <span class="eyebrow shrink-0 text-muted-foreground">{diff.tag ? '· State' : 'State'}</span>
            {#if diff.status.from}
              <span class={cn(statusText(diff.status.from), 'opacity-70')}>{statusLabel(diff.status.from)}</span>
              <span class="text-muted-foreground/60">→</span>
            {/if}
            <span class={statusText(diff.status.to)}>{statusLabel(diff.status.to)}</span>
          {/if}
        </div>
      {/if}

      {#each diff.changes as change, index (index)}
        {@const tone = CHANGE_TONE[change.kind]}
        <div class="flex items-center gap-2 text-small">
          <span
            class={cn(
              'stamp w-3 shrink-0 text-center',
              tone === 'add' ? 'text-status-done' : tone === 'remove' ? 'text-severity-lie' : 'text-muted-foreground/60',
            )}
          >
            {tone === 'add' ? '+' : tone === 'remove' ? '−' : '·'}
          </span>
          <FadeText class="min-w-0 flex-1 text-muted-foreground" text={change.label} />
          {#if change.peerName !== null}
            {@const peer = rows.get(change.peerName)}
            <a
              href={hrefOf(change.peerName)}
              data-block={change.peerName}
              class="max-w-56 min-w-0 shrink text-muted-foreground transition-colors hover:text-foreground"
            >
              {#if peer?.title.trim()}<FadeText text={peer.title.trim()} />{:else}<BlockName name={change.peerName} />{/if}
            </a>
          {/if}
        </div>
      {/each}

      {#each marks as mark (mark.blockName)}
        {@const row = rows.get(mark.blockName)}
        <Tooltip text={MARK_LABEL[mark.mark]} class="block min-w-0">
          <a
            href={hrefOf(mark.blockName)}
            data-block={mark.blockName}
            class="-mx-1.5 flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-hover"
          >
            <span class={cn('stamp w-3 shrink-0 text-center', MARK_TEXT[mark.mark])}>{MARK_SIGN[mark.mark] || '·'}</span>
            {#if row}
              <TagIcon tag={tags.tagOf(row)} class="size-3.5 shrink-0 text-muted-foreground/70" />
            {/if}
            <FadeText
              class={cn(
                'min-w-0 flex-1 text-ui',
                mark.mark === 'deleted' ? 'text-severity-lie line-through decoration-severity-lie/40' : 'text-foreground',
              )}
              text={row?.title.trim() || mark.blockName}
            />
          </a>
        </Tooltip>
      {/each}
    </div>
  {/if}

  {#if silent}
    <p class="text-ui text-muted-foreground">This range did not change the block itself.</p>
  {/if}
</div>

<style>
  .diff-body :global(ins) {
    background: color-mix(in oklab, var(--status-done) 20%, transparent);
    color: var(--status-done);
    text-decoration: none;
    border-radius: var(--radius-sm);
    padding: 0 calc(var(--spacing) * 0.5);
  }

  .diff-body :global(del) {
    background: color-mix(in oklab, var(--severity-lie) 15%, transparent);
    color: var(--severity-lie);
    text-decoration: line-through;
    text-decoration-color: color-mix(in oklab, var(--severity-lie) 60%, transparent);
    border-radius: var(--radius-sm);
    padding: 0 calc(var(--spacing) * 0.5);
  }
</style>
