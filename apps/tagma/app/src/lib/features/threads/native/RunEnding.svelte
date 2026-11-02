<script lang="ts">
  import X from '@lucide/svelte/icons/x';
  import RunEndingStrip from '@runlith/chat-ui/RunEndingStrip.svelte';
  import { messageTime } from '@runlith/chat-ui/chatTime';
  import { rewindTargets, trailingFailedTurns } from '@runlith/chat-ui/rewind';
  import type { CompactionChoice } from '@tagma/server/native-harness/contract/wire/compactionChoices';
  import { CountdownClock } from '$lib/features/providers/accounts/CountdownClock.svelte.js';
  import { modelLabel, skipWords } from '$lib/features/providers/usage/spendWords.js';
  import { ProviderCatalog } from '$lib/features/providers/Catalog.svelte.js';
  import { Button } from '$lib/shared/ui/button/index.js';
  import type { ChatHold } from '../ChatHold.svelte.js';
  import type { ModelPanelState } from '../ModelPanelState.svelte.js';
  import type { ShownThread } from '../ShownThread.js';
  import type { ThreadViews } from '../thread/ThreadViews.js';
  import type { ThreadWrites } from '../ThreadWrites.js';
  import { ThreadCompaction } from '../thread/ThreadCompaction.svelte.js';
  import { tokensWord } from './compactionWords.js';
  import ModelSummary from './ModelSummary.svelte';
  import type { Rewinds } from './Rewinds.svelte.js';
  import { runEndingLine } from './runEndingLine.js';

  let {
    shown,
    chat,
    views,
    writes,
    panel,
    rewinds,
  }: { shown: ShownThread; chat: ChatHold; views: ThreadViews; writes: ThreadWrites; panel: ModelPanelState; rewinds: Rewinds } = $props();

  const countdownClock = CountdownClock.use();
  const catalog = ProviderCatalog.use();
  const commands = $derived(chat.commands);
  const ending = $derived(chat.session?.ending ?? null);
  $effect(() => {
    if (ending !== null) return countdownClock.watch();
  });
  const endingLine = $derived(ending === null ? null : runEndingLine(catalog.models, ending, countdownClock.now));
  const failedTail = $derived.by(() => {
    if (ending?.kind !== 'failed' || ending.failure?.retryable !== false) return null;
    const targets = rewindTargets(chat.target.fold.entries);
    const tail = trailingFailedTurns(targets);
    if (tail === null) return null;
    const landing = targets.find((target) => target.runId === tail.at)?.occurredAt;
    return { ...tail, landing: landing === undefined ? null : messageTime(landing, 'en') };
  });
  const compaction = $derived(shown.lease?.get(ThreadCompaction) ?? null);
  const refusal = $derived(compaction?.refusal ?? null);
  const refusalDetail = $derived.by(() => {
    const read = compaction?.choices ?? null;
    if (refusal === null) return null;
    if (read === null || read.resolved.skipped.length === 0) return refusal;
    return read.resolved.skipped
      .map((skip) => `${modelLabel(catalog.models, skip.provider, skip.model)} ${skipWords(skip.reason, skip.until, countdownClock.now)}`)
      .join(' · ');
  });
  const continues = $derived(shown.row?.capabilities.continue ?? true);
  const continueWith = $derived.by(() => {
    const settings = views.model.settings;
    return settings && settings.modelShort !== '' ? settings : null;
  });

  function compactWith(row: CompactionChoice): void {
    void writes.compact('step', row);
  }

  function togglePanel(mode: 'model' | 'compact'): void {
    if (panel.current?.mode === mode) panel.close();
    else panel.open(mode);
  }
</script>

{#snippet continueRun(variant: 'outline' | 'ghost')}
  {#if continues}
    <Button
      type="button"
      {variant}
      size="sm"
      class="rounded-full"
      disabled={commands.busy === 'continue'}
      onclick={() => void chat.run(commands.continue(), false)}
    >
      {commands.busy === 'continue' ? 'Continuing…' : 'Continue'}
      {#if continueWith !== null}
        <span class="inline-flex min-w-0 items-center gap-1.5 text-small"><ModelSummary settings={continueWith} /></span>
      {/if}
    </Button>
  {/if}
{/snippet}

{#snippet endingWays()}
  {#if failedTail === null}
    {@render continueRun('outline')}
  {:else}
    {@const tail = failedTail}
    <div class="flex flex-wrap items-center justify-end gap-1.5">
      <Button type="button" size="sm" class="rounded-full" disabled={rewinds.busy} onclick={() => void rewinds.rewind(tail.at, 'from')}>
        ↶ Rewind {tail.count === 1 ? 'the failed turn' : `${tail.count} failed turns`}
        {#if tail.landing !== null}
          <span class="font-mono text-meta font-medium opacity-70">to {tail.landing}</span>
        {/if}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        class="rounded-full"
        data-panel-door
        onpointerdown={(event: PointerEvent) => event.preventDefault()}
        onclick={() => togglePanel('model')}
      >
        Change model…
      </Button>
      {@render continueRun('ghost')}
    </div>
  {/if}
{/snippet}

{#snippet refusalWays()}
  {@const read = compaction?.choices ?? null}
  {@const own = read?.own ?? null}
  <div class="flex items-center gap-1.5">
    {#if read !== null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        class="rounded-full"
        data-panel-door
        onpointerdown={(event: PointerEvent) => event.preventDefault()}
        onclick={() => togglePanel('compact')}
      >
        Choose a model…
      </Button>
      {#if own !== null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          class="rounded-full"
          disabled={commands.pending || !own.spendable}
          onclick={() => compactWith(own)}
        >
          Compact with {own.label}
          {#if own.estimate !== null && own.estimate.passes !== null}
            <span class="font-mono text-meta font-medium text-muted-foreground">≈{tokensWord(own.estimate.inputTokens)}</span>
          {/if}
        </Button>
      {/if}
    {/if}
    <Button type="button" variant="ghost" size="icon-sm" class="rounded-full" aria-label="Dismiss" onclick={() => compaction?.dismiss()}>
      <X class="size-3.5" />
    </Button>
  </div>
{/snippet}

{#if refusal !== null}
  <RunEndingStrip tone="failure" text="Not compacted: nothing in the chain can be spent" detail={refusalDetail} action={refusalWays} />
{/if}
{#if endingLine !== null}
  <RunEndingStrip tone={endingLine.tone} text={endingLine.text} detail={endingLine.detail} action={endingWays} />
{/if}
