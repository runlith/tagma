<script lang="ts">
  import type { CallRecord } from '@runlith/agent/callProgress';
  import { elapsedMs, exitWords, type ProcessLine } from '$lib/features/executions/processes/lines.js';
  import { formatSpan } from '$lib/shared/figures.js';

  let { call, line }: { call: CallRecord; line: ProcessLine | null } = $props();

  const ENDINGS: Readonly<Record<CallRecord['phase'], string>> = {
    preparing: 'ended',
    waiting: 'ended',
    running: 'ended',
    stopping: 'ended',
    completed: 'ended',
    failed: 'failed',
    stopped: 'stopped',
    unavailable: 'host unavailable',
    interrupted: 'interrupted',
  };

  const exit = $derived(line?.exit ?? null);
  const took = $derived(
    line !== null
      ? elapsedMs(line, call.endedAt ?? call.startedAt)
      : call.endedAt === null
        ? null
        : Math.max(0, call.endedAt - (call.admittedAt ?? call.startedAt)),
  );

  const FACT = 'shrink-0 font-mono text-meta text-muted-foreground/60';
</script>

<span class="ml-1 inline-flex shrink-0 items-baseline gap-3">
  {#if exit !== null}
    <span class={[FACT, exit._tag === 'Code' && exit.code === 0 ? 'text-muted-foreground/90' : 'text-destructive']} data-call-ended
      >{exitWords(exit)}</span
    >
  {:else}
    <span class={[FACT, call.phase === 'failed' ? 'text-destructive' : '']} data-call-ended>{ENDINGS[call.phase]}</span>
  {/if}
  {#if took !== null}
    <span class={[FACT, 'tabular-nums']}>after {formatSpan(took)}</span>
  {/if}
</span>
