<script lang="ts">
  import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
  import CircleStop from '@lucide/svelte/icons/circle-stop';
  import Waiting from '@runlith/chat-ui/Waiting.svelte';
  import SquareTerminal from '@lucide/svelte/icons/square-terminal';
  import Terminal from '@lucide/svelte/icons/terminal';
  import type { LoadExecution } from '@tagma/server/executions/contract/wire/load';
  import FadeText from '$lib/shared/FadeText.svelte';
  import PathText from '$lib/shared/PathText.svelte';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import { Button } from '$lib/shared/ui/button/index.js';
  import { formatBytes } from '$lib/shared/figures.js';
  import { siteLink } from '$lib/features/browser/links.js';
  import { Notices } from '$lib/features/notices/Service.svelte.js';
  import { linkTarget } from '$lib/features/opening/linkTarget.js';
  import { Opening } from '$lib/features/opening/Opening.svelte.js';
  import type { CommandView } from '$lib/features/executions/commands/Activity.svelte.js';
  import { ExecutionActs } from '$lib/features/executions/acts.svelte.js';
  import NoOutput from '$lib/features/executions/commands/NoOutput.svelte';
  import { percent } from '$lib/features/executions/load/rows.js';
  import { isLive, type ProcessLine } from '$lib/features/executions/processes/lines.js';
  import TerminalView from '$lib/features/executions/terminal/View.svelte';
  import { Terminals } from '$lib/features/executions/worktrees/Terminals.svelte.js';
  import CommandActs from './CommandActs.svelte';
  import CommandStatus from './CommandStatus.svelte';
  import TerminalOpen from './TerminalOpen.svelte';

  let {
    execution,
    line,
    view,
    open,
    onToggle,
    onLeave,
  }: {
    execution: LoadExecution;
    line: ProcessLine | null;
    view: CommandView;
    open: boolean;
    onToggle: () => void;
    onLeave: () => void;
  } = $props();

  const acts = ExecutionActs.use();
  const notices = Notices.use();
  const opening = Opening.use();
  const terminals = Terminals.use();

  const terminal = $derived((line?.transport ?? execution.transport) === 'pty');
  const printed = $derived(line?.transport === 'pipes' ? line.printed : null);
  const title = $derived(line?.label ?? line?.command ?? execution.label);
  const command = $derived(line !== null && line.label === null);
  const opens = $derived(line !== null && line.opens && isLive(line));
  const reveals = $derived(terminal && opens);
  const ports = $derived(line?.ports ?? []);
  const stopping = $derived(acts.busy(execution.projectId, execution.key) === 'stop');

  function activate(): void {
    if (line === null || !reveals) {
      onToggle();
      return;
    }
    onLeave();
    void terminals.reveal(line.key);
  }

  async function stopUnlisted(): Promise<void> {
    const outcome = await acts.stop(execution.projectId, execution.key, { kind: execution.kind, execution: execution.execution });
    if (outcome?._tag === 'Refused') notices.error('Stop', `${outcome.code}: ${outcome.reason}`);
  }
</script>

<div
  class={['group/line relative flex flex-col rounded-md py-1.5 pr-1.5 pl-2 select-none', open ? 'bg-selected' : 'hover:bg-hover']}
  data-work-line={execution.key}
>
  <button
    type="button"
    class="absolute inset-0 rounded-md outline-none focus-visible:inset-ring-1 focus-visible:inset-ring-ring"
    aria-expanded={reveals ? undefined : open}
    aria-label={reveals ? `${title} — open its terminal` : `${title} — ${open ? 'hide' : 'show'} its command and output`}
    onclick={activate}
  ></button>
  <div class="pointer-events-none relative flex min-w-0 items-start gap-2">
    <span class={['flex h-4.5 w-3 shrink-0 items-center', printed !== true && 'text-muted-foreground']}>
      {#if terminal}<SquareTerminal class="size-3" />{:else}<Terminal class="size-3" />{/if}
    </span>
    <div class="flex min-w-0 flex-1 flex-col gap-0.5">
      <div class="flex h-4.5 min-w-0 items-center gap-2">
        <FadeText class={['flex-1 text-small leading-4.5', command && 'font-mono']} text={title} />
        <span class="flex h-4.5 shrink-0 items-center">
          {#if line !== null}
            <span class="flex items-center group-focus-within/line:hidden group-hover/line:hidden group-has-data-[state=open]/line:hidden">
              <CommandStatus {line} {view} held={line.wait === 'foreground'} foreground={false} />
            </span>
          {/if}
          <span
            class="pointer-events-auto hidden items-center group-focus-within/line:flex group-hover/line:flex has-data-[state=open]:flex"
          >
            {#if line !== null}
              {#if opens}<TerminalOpen terminalKey={line.key} onOpen={onLeave} />{/if}
              <CommandActs {line} {view} onOpen={onLeave} />
            {:else}
              <Tooltip text={terminal ? 'Stop this terminal — the agent keeps running' : 'Stop this command — the agent keeps running'}>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  class="size-6 hover:bg-hover-danger hover:text-destructive"
                  disabled={stopping}
                  aria-label={terminal ? 'Stop terminal' : 'Stop command'}
                  onclick={() => void stopUnlisted()}
                >
                  {#if stopping}<Waiting class="size-3" />{:else}<CircleStop class="size-3" />{/if}
                </Button>
              </Tooltip>
            {/if}
          </span>
        </span>
      </div>
      <div class="flex h-4 min-w-0 items-center gap-3 overflow-hidden text-meta whitespace-nowrap text-muted-foreground" data-work-figures>
        {#each ports as port (`${port.address}:${port.port}`)}
          {#if port.url !== null}
            {@const url = port.url}
            <a
              class="pointer-events-auto inline-flex shrink-0 items-center gap-0.5 font-mono text-foreground hover:underline"
              href={url}
              data-work-port={port.port}
              {@attach linkTarget(opening, () => siteLink(url, { thread: line?.owner.thread ?? undefined }))}
              >localhost:{port.port}<ArrowUpRight class="size-3" /></a
            >
          {:else}
            <span class="shrink-0 font-mono text-foreground" data-work-port={port.port}>{port.address}:{port.port}</span>
          {/if}
        {/each}
        {#if line?.cwd}<PathText class="min-w-0 shrink font-mono" path={line.cwd} />{/if}
        {#if line?.current}<span class="shrink-0 font-mono">{line.current}</span>{/if}
        {#if execution.share !== null}<span class="shrink-0 tabular">{percent(execution.share)}</span>{/if}
        {#if execution.memoryBytes > 0}<span class="shrink-0 tabular">{formatBytes(execution.memoryBytes)}</span>{/if}
        {#if line?.wait === 'background'}<span class="shrink-0 opacity-70">background</span>{/if}
      </div>
    </div>
  </div>
  {#if open}
    <div class="relative flex min-w-0 flex-col gap-1.5 pt-1.5 select-text">
      <p class="pr-1 pl-5 font-mono text-meta break-all text-foreground/85" data-work-command>
        <span class="text-muted-foreground">{line?.note ? `${line.note} $` : '$'}</span>
        {line?.command ?? execution.label}
      </p>
      {#if line !== null && line.transport === 'pipes'}
        {#if printed !== false}
          <TerminalView
            class="h-56 rounded-md border border-vein"
            key={line.key}
            projectId={execution.projectId}
            address={line.address}
            program={title}
            source={{ _tag: 'Output', record: line.kind }}
            cwd={line.cwd}
          />
        {:else}
          <NoOutput {line} class="rounded-md border border-vein" />
        {/if}
      {/if}
    </div>
  {/if}
</div>
