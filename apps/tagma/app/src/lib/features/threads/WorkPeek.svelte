<script lang="ts">
  import Activity from '@lucide/svelte/icons/activity';
  import Waiting from '@runlith/chat-ui/Waiting.svelte';
  import Terminal from '@lucide/svelte/icons/terminal';
  import type { LoadExecution, LoadRow } from '@tagma/server/executions/contract/wire/load';
  import FadeText from '$lib/shared/FadeText.svelte';
  import * as Popover from '$lib/shared/ui/popover/index.js';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import { Button } from '$lib/shared/ui/button/index.js';
  import { formatBytes } from '$lib/shared/figures.js';
  import type { CommandView } from '$lib/features/executions/commands/Activity.svelte.js';
  import { percent } from '$lib/features/executions/load/rows.js';
  import { View } from '$lib/features/executions/load/View.svelte.js';
  import { onLinkOpened } from '$lib/features/opening/linkTarget.js';
  import { threadPeeks } from './threadPeek.svelte.js';
  import WorkLine from './WorkLine.svelte';

  let {
    threadId,
    row,
    work,
    processes,
    anchor,
    badge,
    peekKey,
    byKey,
  }: {
    threadId: string;
    row: LoadRow;
    work: readonly LoadExecution[];
    processes: CommandView;
    anchor: HTMLElement;
    badge: HTMLElement | null;
    peekKey: string;
    byKey: boolean;
  } = $props();

  const load = View.use();

  let expanded = $state<string | null>(null);
  let panel = $state<HTMLDivElement | null>(null);

  const left = $derived.by(() => {
    const pids = new Set((row.work?.residuals ?? []).map((one) => one.pid));
    return row.processes.filter((one) => pids.has(one.pid));
  });
  const stopping = $derived(load.working(row.key));
  const ending = $derived(load.ending(row.key, processes.now));
  const endingLeft = $derived(left.some((one) => load.working(`${row.key}/${one.pid}`)));

  $effect(() => processes.watch());

  function close(): void {
    threadPeeks.close(peekKey);
  }

  function openLoad(): void {
    close();
    load.reveal(threadId);
  }

  async function endLeft(): Promise<void> {
    await Promise.all(left.filter((one) => one.killable).map((one) => load.kill(row, one)));
  }
</script>

<Popover.Root
  open
  onOpenChange={(next) => {
    if (!next) close();
  }}
>
  <Popover.Content
    {anchor}
    side="right"
    align="start"
    sideOffset={8}
    collisionPadding={12}
    trapFocus={false}
    initialFocus={byKey ? () => panel : false}
    returnFocus={() => (byKey || panel?.contains(document.activeElement) ? badge : null)}
    class="w-120 max-w-[calc(100vw-1.5rem)] gap-0 p-0"
  >
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div
      bind:this={panel}
      {@attach onLinkOpened(close)}
      tabindex="-1"
      class="flex min-w-0 flex-col text-small outline-none"
      role="group"
      aria-label="Commands and terminals of this thread"
      data-work-peek={threadId}
    >
      <div class="flex h-9 shrink-0 items-center gap-2 border-b pr-1.5 pl-3">
        <span class="flex items-center gap-1.5 font-medium">
          <Terminal class="size-3 text-status-open" /><span class="tabular">{work.length}</span> running
        </span>
        {#if ending !== null}
          <FadeText
            class={['text-meta', ending.failed ? 'text-destructive' : 'text-status-done']}
            title={ending.hint || undefined}
            text={ending.text}
          />
        {/if}
        <span class="ml-auto flex gap-3 font-mono text-meta whitespace-nowrap text-muted-foreground tabular-nums" data-work-total>
          {#if work.some((one) => one.share !== null)}<span>{percent(row.share)}</span>{/if}<span>{formatBytes(row.memoryBytes)}</span>
        </span>
        <Tooltip text="Open in Load — its processes and PIDs">
          <Button variant="quiet" size="icon-xs" aria-label="Open in Load" onclick={openLoad}>
            <Activity class="size-3" />
          </Button>
        </Tooltip>
        <Tooltip text="Stop every command and terminal of this thread, and end what they left running — the agent keeps running">
          <Button
            variant="quiet"
            size="xs"
            class="hover:bg-hover-danger hover:text-destructive"
            disabled={stopping}
            onclick={() => void load.stop(row)}
          >
            {#if stopping}<Waiting class="size-3" />{/if}
            Stop all
          </Button>
        </Tooltip>
      </div>
      <div class="flex max-h-96 flex-col gap-px overflow-y-auto p-1">
        {#each work as execution (execution.key)}
          <WorkLine
            {execution}
            line={processes.line(execution.key)}
            view={processes}
            open={expanded === execution.key}
            onToggle={() => (expanded = expanded === execution.key ? null : execution.key)}
            onLeave={close}
          />
        {/each}
      </div>
      {#if left.length > 0}
        <div class="flex h-8 shrink-0 items-center gap-2 border-t pr-1.5 pl-3 text-muted-foreground" data-work-left>
          <FadeText class="flex-1">
            <span class="tabular text-status-in-work">{left.length}</span>
            {left.length === 1 ? 'process' : 'processes'} left running after a stop
          </FadeText>
          <Button
            variant="quiet"
            size="xs"
            class="hover:bg-hover-danger hover:text-destructive"
            disabled={endingLeft || !left.some((one) => one.killable)}
            onclick={() => void endLeft()}
          >
            {#if endingLeft}<Waiting class="size-3" />{/if}
            End them
          </Button>
        </div>
      {/if}
    </div>
  </Popover.Content>
</Popover.Root>
