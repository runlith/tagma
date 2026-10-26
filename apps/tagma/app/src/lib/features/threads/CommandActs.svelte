<script lang="ts">
  import Waiting from '@runlith/chat-ui/Waiting.svelte';
  import Square from '@lucide/svelte/icons/square';
  import Timer from '@lucide/svelte/icons/timer';
  import X from '@lucide/svelte/icons/x';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import { Button, buttonVariants } from '$lib/shared/ui/button/index.js';
  import type { CommandView } from '$lib/features/executions/commands/Activity.svelte.js';
  import LifeLadder from '$lib/features/executions/commands/LifeLadder.svelte';
  import { isLive, isQueued, type ProcessLine } from '$lib/features/executions/processes/lines.js';
  import OutputTabOpen from './OutputTabOpen.svelte';

  let { line, view, life = true, onOpen }: { line: ProcessLine; view: CommandView; life?: boolean; onOpen?: () => void } = $props();

  const live = $derived(isLive(line));
  const queued = $derived(isQueued(line));
  const busy = $derived(view.busy(line.key));
</script>

<div class="flex min-w-0 items-center gap-1 text-small text-muted-foreground" data-command-acts>
  {#if line.kind === 'command'}
    <OutputTabOpen {line} projectId={view.projectId} {onOpen} />
  {/if}
  {#if live}
    <Tooltip
      text={queued
        ? 'Take it out of the queue — the agent keeps running'
        : line.kind === 'terminal'
          ? 'Stop this terminal — the agent keeps running'
          : 'Stop this command — the agent keeps running'}
    >
      <Button
        variant="ghost"
        size="icon-xs"
        class="size-6 hover:bg-hover-danger hover:text-destructive"
        disabled={busy !== null}
        aria-label={queued ? 'Cancel command' : line.kind === 'terminal' ? 'Stop terminal' : 'Stop command'}
        onclick={() => void view.stop(line)}
      >
        {#if busy === 'stop'}<Waiting class="size-3" />{:else if queued}<X class="size-3" />{:else}<Square class="size-3" />{/if}
      </Button>
    </Tooltip>
    {#if life && line.kind === 'command' && line.limit !== null}
      <Tooltip text="Change its life — how long it may run before it is stopped">
        <LifeLadder {line} {view} class={[buttonVariants({ variant: 'quiet', size: 'icon-xs' }), 'size-6']}>
          {#if busy === 'limit'}<Waiting class="size-3" />{:else}<Timer class="size-3" />{/if}
        </LifeLadder>
      </Tooltip>
    {/if}
  {/if}
</div>
