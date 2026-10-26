<script lang="ts">
  import { retainedToolValue } from '@tagma/server/native-harness/contract/wire/toolResult';
  import type { GraphToolAnswer } from '@tagma/server/graph/contract/wire/toolAnswers';
  import type { PerformanceAnswer } from '@tagma/server/performance/contract/wire/performance';
  import { performanceText } from '@tagma/server/performance/voice';
  import type { ChatEntryOf, ChatMarkdownBody } from '@runlith/chat-ui/renderers';
  import ToolRow from '@runlith/chat-ui/entries/ToolRow.svelte';
  import type { Snippet } from 'svelte';
  import { diffParam } from '$lib/features/workspace/address.js';
  import Told from '$lib/shared/Told.svelte';
  import { refusalOf } from '$lib/wire/refusal.js';
  import BlockCard from '../BlockCard.svelte';
  import ToolBlockDiff from './ToolBlockDiff.svelte';

  let { entry, markdown }: { entry: ChatEntryOf<'tool'>; markdown: Snippet<[ChatMarkdownBody]> } = $props();

  function byteText(size: number): string {
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }

  const retained = $derived(retainedToolValue(entry.toolOutput));
  const retainedFact = $derived(
    retained === null
      ? null
      : `${byteText(retained.byteLength)} · ${retained.lineCount} ${retained.lineCount === 1 ? 'line' : 'lines'} · whole value retained`,
  );
  const result = $derived(entry.toolOutput as GraphToolAnswer | PerformanceAnswer | undefined);
  const rows = $derived(result?.status !== 'ok' ? [] : 'blocks' in result ? result.blocks : 'tasks' in result ? result.tasks : []);

  const wrote = $derived(
    result?.status === 'ok' && 'block' in result && 'journal' in result && result.journal !== undefined
      ? { name: result.block.name, range: result.journal }
      : null,
  );
</script>

{#if retained !== null}
  <div class="grid min-w-0 gap-1.5">
    <div class="text-small text-muted-foreground/50">{retainedFact}</div>
    <pre
      class="max-h-96 overflow-auto rounded-lg border border-border/60 bg-background/60 px-3 py-2 font-mono text-small leading-5 whitespace-pre-wrap text-muted-foreground/80">{retained.preview}</pre>
  </div>
{:else if result?.status === 'refused'}
  <div class="rounded-lg border border-border/60 bg-background/60 px-3 py-2">
    <Told told={refusalOf(result).told} detailsLabel="What the agent was told" />
  </div>
{:else if result?.status === 'ok' && 'overview' in result}
  <div class="max-h-96 overflow-auto rounded-lg border border-border/60 bg-background/60 px-3 py-2">
    {@render markdown({ cacheKey: entry.id, text: result.overview })}
  </div>
{:else if result?.status === 'ok' && 'reads' in result}
  <div class="grid min-w-0 gap-1.5">
    {#each result.reads as read (read.name)}
      <BlockCard block={read} place={{ projectId: read.projectId, checkout: null }} />
      {#if read.body.trim()}
        <div class="max-h-96 overflow-auto rounded-lg border border-border/60 bg-background/60 px-3 py-2">
          {@render markdown({ cacheKey: `${entry.id}:${read.name}`, text: read.body })}
        </div>
      {/if}
    {/each}
  </div>
{:else if result?.status === 'ok' && 'performance' in result}
  <div class="max-h-96 overflow-auto rounded-lg border border-border/60 bg-background/60 px-3 py-2">
    <pre class="font-mono text-small leading-5 whitespace-pre-wrap text-muted-foreground/80">{performanceText(
        result.performance,
        result.artifact,
      )}</pre>
  </div>
{:else if result?.status === 'ok' && 'page' in result}
  <div class="max-h-96 overflow-auto rounded-lg border border-border/60 bg-background/60 px-3 py-2">
    <pre class="font-mono text-small leading-5 whitespace-pre-wrap text-muted-foreground/80">{result.page}</pre>
  </div>
{:else if result?.status === 'ok' && 'block' in result}
  <div class="grid min-w-0 gap-1.5">
    <BlockCard block={result.block} diff={wrote === null ? undefined : diffParam(wrote.range)} place={result.graphCopy} />
    {#if wrote !== null}
      <ToolBlockDiff name={wrote.name} range={wrote.range} />
    {/if}
  </div>
{:else if rows.length > 0}
  <div class="grid gap-1">
    {#each rows as block (block.name)}
      <BlockCard {block} />
    {/each}
  </div>
{:else}
  <ToolRow {entry} />
{/if}
