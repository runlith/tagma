<script lang="ts">
  import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
  import Waiting from '@runlith/chat-ui/Waiting.svelte';
  import Square from '@lucide/svelte/icons/square';
  import SquareTerminal from '@lucide/svelte/icons/square-terminal';
  import Terminal from '@lucide/svelte/icons/terminal';
  import type { LoadExecution } from '@tagma/server/executions/contract/wire/load';
  import FadeText from '$lib/shared/FadeText.svelte';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import { Button } from '$lib/shared/ui/button/index.js';
  import { formatBytes } from '$lib/shared/figures.js';
  import { Notices } from '$lib/features/notices/Service.svelte.js';
  import type { CommandView } from '$lib/features/executions/commands/Activity.svelte.js';
  import { ExecutionActs } from '$lib/features/executions/acts.svelte.js';
  import { percent } from '$lib/features/executions/load/rows.js';
  import { isLive, type ProcessLine } from '$lib/features/executions/processes/lines.js';
  import TerminalView from '$lib/features/executions/terminal/View.svelte';
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

  type Fact = { readonly text: string; readonly url: string | null; readonly tone: 'mono' | 'faint' | 'figure' };

  const facts = $derived<readonly Fact[]>([
    ...(line?.current ? [{ text: line.current, url: null, tone: 'mono' as const }] : []),
    ...(line?.ports ?? []).map((port) => ({
      text: port.url === null ? `${port.address}:${port.port}` : `localhost:${port.port}`,
      url: port.url,
      tone: 'figure' as const,
    })),
    ...(execution.share === null ? [] : [{ text: percent(execution.share), url: null, tone: 'figure' as const }]),
    ...(execution.memoryBytes > 0 ? [{ text: formatBytes(execution.memoryBytes), url: null, tone: 'figure' as const }] : []),
    ...(line?.wait === 'background' ? [{ text: 'background', url: null, tone: 'faint' as const }] : []),
  ]);
  const terminal = $derived((line?.transport ?? execution.transport) === 'pty');
  const printed = $derived(line?.transport === 'pipes' ? line.printed : null);
  const title = $derived(line?.label ?? line?.command ?? execution.label);
  const command = $derived(line !== null && line.label === null);
  const stopping = $derived(acts.busy(execution.projectId, execution.key) === 'stop');

  async function stopUnlisted(): Promise<void> {
    const outcome = await acts.stop(execution.projectId, execution.key, { kind: execution.kind, execution: execution.execution });
    if (outcome?._tag === 'Refused') notices.error('Stop', `${outcome.code}: ${outcome.reason}`);
  }
</script>

<div
  class={['group/line flex flex-col rounded-md py-1.5 pr-1.5 pl-2', open ? 'bg-selected' : 'hover:bg-hover']}
  data-work-line={execution.key}
>
  <div class="flex min-w-0 items-start gap-2">
    <span class={['flex h-4.5 w-3 shrink-0 items-center', printed !== true && 'text-muted-foreground']}>
      {#if terminal}<SquareTerminal class="size-3" />{:else}<Terminal class="size-3" />{/if}
    </span>
    <div class="flex min-w-0 flex-1 flex-col gap-0.5">
      <button
        type="button"
        class="block min-w-0 rounded-sm text-left outline-none focus-visible:inset-ring-1 focus-visible:inset-ring-ring"
        aria-expanded={open}
        aria-label={`${title} — ${open ? 'hide' : 'show'} its command and output`}
        onclick={onToggle}
      >
        <FadeText class={['h-4.5 text-small leading-4.5', command && 'font-mono']} text={title} />
      </button>
      <span class="flex min-w-0 items-center gap-1.5 overflow-hidden text-meta whitespace-nowrap text-muted-foreground" data-work-figures>
        {#each facts as fact, at (at)}
          {#if at > 0}<span class="opacity-50">·</span>{/if}
          {#if fact.url !== null}
            <a class="inline-flex items-center gap-0.5 text-status-open hover:underline" href={fact.url}
              >{fact.text}<ArrowUpRight class="size-3" /></a
            >
          {:else}
            <span class={fact.tone === 'mono' ? 'font-mono' : fact.tone === 'faint' ? 'opacity-70' : 'tabular'}>{fact.text}</span>
          {/if}
        {/each}
      </span>
    </div>
    <span class="flex h-4.5 shrink-0 items-center">
      {#if line !== null}
        <span class="flex items-center group-focus-within/line:hidden group-hover/line:hidden group-has-data-[state=open]/line:hidden">
          <CommandStatus {line} {view} held={line.wait === 'foreground'} foreground={false} />
        </span>
      {/if}
      <span class="hidden items-center group-focus-within/line:flex group-hover/line:flex has-data-[state=open]:flex">
        {#if line !== null}
          {#if line.opens && isLive(line)}<TerminalOpen terminalKey={line.key} onOpen={onLeave} />{/if}
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
              {#if stopping}<Waiting class="size-3" />{:else}<Square class="size-3" />{/if}
            </Button>
          </Tooltip>
        {/if}
      </span>
    </span>
  </div>
  {#if open}
    <div class="flex min-w-0 flex-col gap-1.5 pt-1.5">
      <p class="pr-1 pl-5 font-mono text-meta break-all text-foreground/85" data-work-command>
        <span class="text-muted-foreground">{line?.note ? `${line.note} $` : '$'}</span>
        {line?.command ?? execution.label}
      </p>
      {#if line !== null && line.transport === 'pipes' && printed !== false}
        <TerminalView
          class="h-56 rounded-md border border-vein"
          key={line.key}
          projectId={execution.projectId}
          address={line.address}
          program={title}
          source={{ _tag: 'Output', record: line.kind }}
          cwd={line.cwd}
        />
      {/if}
    </div>
  {/if}
</div>
