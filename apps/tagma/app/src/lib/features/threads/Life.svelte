<script module lang="ts">
  import type { ThreadListRow } from '@tagma/server/threads/contract/wire/list';

  export type ThreadState = 'working' | 'stalled' | 'waiting' | 'failed' | 'unread' | 'cut' | 'quiet';
  export type ThreadMark = { state: ThreadState; label: string };

  export function threadMark(row: ThreadListRow): ThreadMark {
    if (row.halt !== undefined && (row.life === 'working' || row.life === 'stalled')) return { state: row.life, label: 'recovering' };
    if (row.life === 'working') return { state: 'working', label: 'working' };
    if (row.life === 'stalled') return { state: 'stalled', label: 'stalled — no movement' };
    if (row.life === 'awaiting') return { state: 'waiting', label: 'waiting on you' };
    const outcome = row.outcome;
    if (outcome?.status === 'failed') return { state: 'failed', label: 'failed' };
    if (outcome?.status === 'cut') return { state: 'cut', label: 'cut short — not finished' };
    if (outcome?.status === 'completed') {
      const unread = !outcome.isSeen && row.parentThreadId === null;
      return unread ? { state: 'unread', label: 'finished — unread' } : { state: 'quiet', label: 'finished' };
    }
    if (outcome?.status === 'aborted') return { state: 'quiet', label: 'stopped by you' };
    return { state: 'quiet', label: 'idle' };
  }
</script>

<script lang="ts">
  import Working from '$lib/shared/ui/Working.svelte';
  import { cn } from '$lib/shared/utils.js';

  let { thread, unborn = false, class: className }: { thread: ThreadListRow; unborn?: boolean; class?: string } = $props();

  const mark = $derived<ThreadMark>(threadMark(thread));
  const drawn = $derived(unborn ? 'unborn' : mark.state);

  function failureTitle(row: ThreadListRow): string | null {
    const outcome = row.outcome;
    if (outcome?.status !== 'failed') return null;
    const failure = outcome.failure;
    return (
      [
        failure?.provider,
        failure?.stage,
        failure?.type,
        failure?.httpStatus === undefined ? null : `HTTP ${failure.httpStatus}`,
        failure?.retryable == null ? null : failure.retryable ? 'retryable' : 'non-retryable',
        failure?.modelStarted == null ? null : failure.modelStarted ? 'model started' : 'model not started',
        outcome.failureReason,
        failure == null ? null : `record ${failure.record.threadId} at ${failure.record.entryId}`,
      ]
        .filter((value): value is string => Boolean(value))
        .join(' · ') || null
    );
  }

  const failed = $derived(thread.halt?.reason ?? failureTitle(thread));
  const title = $derived(unborn ? 'being born' : `${mark.label}${failed ? ` — ${failed}` : ''}`);
</script>

<span class={cn('grid size-3.5 shrink-0 place-items-center', className)} role="img" aria-label={title} data-mark={drawn}>
  {#if drawn === 'working' || drawn === 'unborn'}
    <Working muted={drawn === 'unborn'} />
  {:else if drawn !== 'quiet'}
    <span class="mark block"></span>
  {/if}
</span>

<style>
  .mark {
    width: calc(var(--spacing) * 1.75);
    height: calc(var(--spacing) * 1.75);
  }

  [data-mark='waiting'] .mark {
    background: var(--status-open);
    outline: 3px solid color-mix(in oklch, var(--status-open) 24%, transparent);
  }

  [data-mark='failed'] .mark {
    background: var(--destructive);
    outline: 3px solid color-mix(in oklch, var(--destructive) 20%, transparent);
  }

  [data-mark='unread'] .mark {
    background: var(--status-done);
  }

  [data-mark='stalled'] .mark,
  [data-mark='cut'] .mark {
    width: calc(var(--spacing) * 2.25);
    height: calc(var(--spacing) * 2.25);
    border: 1.75px solid var(--status-in-work);
  }

  [data-mark='stalled'] .mark {
    border-color: var(--destructive);
  }
</style>
