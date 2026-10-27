<script lang="ts">
  import { retainedToolValue } from '@tagma/server/native-harness/contract/wire/toolResult';
  import type { GraphToolAnswer } from '@tagma/server/graph/contract/wire/toolAnswers';
  import type { PerformanceAnswer } from '@tagma/server/performance/contract/wire/performance';
  import { performanceText } from '@tagma/server/performance/voice';
  import type { ChatEntryOf, ChatMarkdownBody } from '@runlith/chat-ui/renderers';
  import ToolRow from '@runlith/chat-ui/entries/ToolRow.svelte';
  import Well from '@runlith/chat-ui/entries/Well.svelte';
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
      : `${byteText(retained.byteLength)} in ${retained.lineCount} ${retained.lineCount === 1 ? 'line' : 'lines'}, kept whole`,
  );
  const result = $derived(entry.toolOutput as GraphToolAnswer | PerformanceAnswer | undefined);
  const rows = $derived(result?.status !== 'ok' ? [] : 'blocks' in result ? result.blocks : 'tasks' in result ? result.tasks : []);

  const wrote = $derived(
    result?.status === 'ok' && 'block' in result && 'journal' in result && result.journal !== undefined
      ? { name: result.block.name, range: result.journal }
      : null,
  );
</script>

{#snippet document(cacheKey: string, text: string)}
  {@render markdown({ cacheKey, size: 'small', class: 'text-muted-foreground', text })}
{/snippet}

{#if retained !== null}
  <div class="grid min-w-0 gap-1.5">
    <div class="text-small text-muted-foreground/60">{retainedFact}</div>
    <Well id={entry.id} text={retained.preview} />
  </div>
{:else if result?.status === 'refused'}
  <Told told={refusalOf(result).told} detailsLabel="What the agent was told" />
{:else if result?.status === 'ok' && 'overview' in result}
  <Well id={entry.id} copy={result.overview}>{@render document(entry.id, result.overview)}</Well>
{:else if result?.status === 'ok' && 'reads' in result}
  <div class="grid min-w-0 gap-1.5">
    {#each result.reads as read (read.name)}
      <Well id={`${entry.id}:${read.name}`} copy={read.body.trim() === '' ? null : read.body} rows>
        <BlockCard block={read} place={{ projectId: read.projectId, checkout: null }} />
        {#if read.body.trim()}
          <div class="mt-1 px-1.5 pb-1">{@render document(`${entry.id}:${read.name}`, read.body)}</div>
        {/if}
      </Well>
    {/each}
  </div>
{:else if result?.status === 'ok' && 'performance' in result}
  <Well id={entry.id} text={performanceText(result.performance, result.artifact)} />
{:else if result?.status === 'ok' && 'page' in result}
  <Well id={entry.id} text={result.page} />
{:else if result?.status === 'ok' && 'block' in result}
  <div class="grid min-w-0 gap-1.5">
    <Well id={entry.id} copy={null} rows>
      <BlockCard block={result.block} diff={wrote === null ? undefined : diffParam(wrote.range)} place={result.graphCopy} />
    </Well>
    {#if wrote !== null}
      <ToolBlockDiff name={wrote.name} range={wrote.range} />
    {/if}
  </div>
{:else if rows.length > 0}
  <Well id={entry.id} copy={null} count={String(rows.length)} rows>
    {#each rows as block (block.name)}
      <BlockCard {block} />
    {/each}
  </Well>
{:else}
  <ToolRow {entry} />
{/if}
