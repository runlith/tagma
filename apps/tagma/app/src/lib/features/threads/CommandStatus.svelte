<script lang="ts">
  import type { CommandView } from '$lib/features/executions/commands/Activity.svelte.js';
  import LifeLadder from '$lib/features/executions/commands/LifeLadder.svelte';
  import {
    elapsedMs,
    exitWords,
    isLive,
    isNearLimit,
    isQueued,
    unstartedNote,
    type ProcessLine,
  } from '$lib/features/executions/processes/lines.js';
  import type { LoadExecution } from '@tagma/server/executions/contract/wire/load';
  import { percent } from '$lib/features/executions/load/rows.js';
  import Bar from '$lib/shared/ui/Bar.svelte';
  import FadeText from '$lib/shared/FadeText.svelte';
  import { formatBytes, formatLimit, formatSpan, UNMEASURED } from '$lib/shared/figures.js';

  let {
    line,
    view,
    held = false,
    adjustable = false,
    foreground = true,
    load = null,
  }: {
    line: ProcessLine;
    view: CommandView;
    held?: boolean;
    adjustable?: boolean;
    foreground?: boolean;
    load?: LoadExecution | null;
  } = $props();

  const live = $derived(isLive(line));
  const silence = $derived(view.unconfirmed(line));
  const now = $derived(view.now);
  const elapsed = $derived(elapsedMs(line, now));
  const near = $derived(isNearLimit(line, now));
  const wait = $derived(held && line.waitMs !== null && line.waitMs > 0 ? line.waitMs : null);
  const span = $derived(wait ?? line.limit?.executionMs ?? null);
  const share = $derived(elapsed === null || span === null || span === 0 ? 0 : (elapsed / span) * 100);
  const changeable = $derived(adjustable && wait === null && line.kind === 'command' && line.limit !== null);

  $effect(() => (live ? view.watch() : undefined));

  const FACT = 'shrink-0 font-mono text-meta text-muted-foreground/60';
  const FIGURE = 'shrink-0 font-mono text-meta tabular-nums text-muted-foreground/90';
</script>

{#snippet clock()}
  {#if span !== null}
    <Bar
      used={share}
      color={wait !== null || near || line.phase === 'stopping' ? 'var(--status-in-work)' : 'var(--muted-foreground)'}
      class="h-0.5 w-10 shrink-0 self-center"
    />
  {/if}
  <span class="tabular-nums">
    <span class={near || line.phase === 'stopping' ? 'text-status-in-work' : 'text-muted-foreground/90'}
      >{elapsed === null ? UNMEASURED : formatSpan(elapsed)}</span
    >{#if wait !== null}&nbsp;of {formatLimit(wait)} wait{:else if line.limit !== null}{line.limit.executionMs === null
        ? ', no limit'
        : ` of ${formatLimit(line.limit.executionMs)}`}{/if}
  </span>
{/snippet}

<span class="ml-1 inline-flex shrink-0 items-baseline gap-3" data-command-status>
  {#if silence !== null}
    <span class={[FACT, 'text-status-in-work']} title={silence}>unconfirmed</span>
  {:else if live}
    {#if isQueued(line)}
      <span class={FACT}>queued</span>
    {:else if changeable}
      <LifeLadder
        {line}
        {view}
        class={[
          FACT,
          '-mx-1.5 inline-flex cursor-pointer items-baseline gap-2 rounded-md px-1.5 transition-colors hover:bg-hover data-[state=open]:bg-selected',
        ]}
      >
        {@render clock()}
      </LifeLadder>
    {:else}
      <span
        class={[FACT, 'inline-flex items-baseline gap-2']}
        data-command-clock
        title={wait !== null
          ? 'Time held in place, of its wait — then it moves to the background and runs on'
          : line.limit === null
            ? 'Time since it was accepted — it has no life limit'
            : 'Time running, of its life — then it is stopped'}
      >
        {@render clock()}
      </span>
    {/if}
    {#if line.phase === 'stopping'}
      <span class={FACT}>stopping</span>
    {/if}
    {#if foreground && line.current !== null && !isQueued(line)}
      <FadeText class={[FACT, 'max-w-48 text-muted-foreground/80']} text={line.current} title={line.current} />
    {/if}
    {#if load !== null && !isQueued(line)}
      {#if load.share !== null}<span class={FIGURE} data-command-cpu>{percent(load.share)}</span>{/if}
      {#if load.memoryBytes > 0}<span class={FIGURE} data-command-memory>{formatBytes(load.memoryBytes)}</span>{/if}
    {/if}
  {:else if line.exit !== null}
    <span class={[FACT, line.exit._tag === 'Code' && line.exit.code === 0 ? 'text-muted-foreground/90' : 'text-destructive']}
      >{exitWords(line.exit)}</span
    >
  {:else if line.unstarted !== null}
    <span class={FACT}>{unstartedNote(line.unstarted)}</span>
  {:else}
    <span class={FACT}>{line.live === 'unheld' ? 'no longer held' : 'ended'}</span>
  {/if}
</span>
