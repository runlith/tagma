<script lang="ts">
  import SkipForward from '@lucide/svelte/icons/skip-forward';
  import Square from '@lucide/svelte/icons/square';
  import Timer from '@lucide/svelte/icons/timer';
  import type { CallRecord } from '@runlith/agent/callProgress';
  import ClampedText from '@runlith/chat-ui/entries/ClampedText.svelte';
  import FadeText from '$lib/shared/FadeText.svelte';
  import { Button, buttonVariants } from '$lib/shared/ui/button/index.js';
  import { formatLimit, formatSpan, UNMEASURED } from '$lib/shared/figures.js';
  import type { CommandView } from '$lib/features/executions/commands/Activity.svelte.js';
  import LifeLadder from '$lib/features/executions/commands/LifeLadder.svelte';
  import { elapsedMs, exitWords, isLive, type ProcessLine } from '$lib/features/executions/processes/lines.js';
  import { WallClock } from '$lib/features/workspace/WallClock.svelte.js';
  import { CallActivity } from './CallActivity.svelte.js';
  import OutputTabOpen from './OutputTabOpen.svelte';

  let { line, view, call, budgetMs }: { line: ProcessLine; view: CommandView; call: CallRecord | null; budgetMs: number | null } = $props();

  const calls = CallActivity.use();
  const clock = WallClock.use();

  const live = $derived(isLive(line));
  const waiting = $derived(call !== null && call.endedAt === null && budgetMs !== null && call.admittedAt !== null);
  const waited = $derived(call === null || call.admittedAt === null ? null : Math.max(0, (call.endedAt ?? clock.now) - call.admittedAt));
  const elapsed = $derived(elapsedMs(line, view.now));
  const busy = $derived(view.busy(line.key));

  $effect(() => (waiting ? clock.watch() : undefined));
  $effect(() => (live ? view.watch() : undefined));
</script>

<div class="grid min-w-0 gap-3 py-1" data-command-sheet>
  {#if line.command !== null}
    <ClampedText text={line.command} id={`${line.key}:command`} code />
  {/if}

  <dl class="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-0.5 text-small tabular-nums">
    {#if waited !== null && budgetMs !== null}
      <dt class="text-muted-foreground">{waiting ? 'Agent waits' : 'Agent waited'}</dt>
      <dd>{formatSpan(waited)} <span class="text-muted-foreground">of {formatSpan(budgetMs)}</span></dd>
    {/if}
    <dt class="text-muted-foreground">{live ? 'Running' : 'Ran'}</dt>
    <dd>
      {elapsed === null ? UNMEASURED : formatSpan(elapsed)}
      {#if live && line.limit !== null}
        <span class="text-muted-foreground"
          >{line.limit.executionMs === null
            ? 'with no life limit'
            : `of its ${formatLimit(line.limit.executionMs)} life, then it is stopped`}</span
        >
      {:else if line.exit !== null}
        <span class={line.exit._tag === 'Code' && line.exit.code === 0 ? 'text-muted-foreground' : 'text-destructive'}
          >{exitWords(line.exit)}</span
        >
      {/if}
    </dd>
    {#if live && line.current !== null}
      <dt class="text-muted-foreground">Now</dt>
      <dd class="min-w-0"><FadeText class="font-mono" text={line.current} /></dd>
    {/if}
  </dl>

  <div class="flex flex-wrap items-center gap-1">
    {#if waiting && call !== null}
      <Button variant="outline" size="xs" disabled={calls.actOf(call) !== null} onclick={() => void calls.control(call, { action: 'stop' })}
        ><SkipForward class="size-3" />Stop waiting</Button
      >
    {/if}
    {#if line.kind === 'command'}
      <OutputTabOpen {line} projectId={view.projectId} worded />
    {/if}
    {#if live && line.kind === 'command' && line.limit !== null}
      <LifeLadder {line} {view} class={buttonVariants({ variant: 'outline', size: 'xs' })}><Timer class="size-3" />Change life</LifeLadder>
    {/if}
    {#if live}
      <Button
        variant="outline"
        size="xs"
        class="text-destructive hover:bg-hover-danger"
        disabled={busy !== null}
        onclick={() => void view.stop(line)}><Square class="size-3" />{line.kind === 'terminal' ? 'Stop terminal' : 'Stop command'}</Button
      >
    {/if}
  </div>
</div>
