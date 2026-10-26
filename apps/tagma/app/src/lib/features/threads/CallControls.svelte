<script lang="ts">
  import ArrowDownToLine from '@lucide/svelte/icons/arrow-down-to-line';
  import Waiting from '@runlith/chat-ui/Waiting.svelte';
  import SkipForward from '@lucide/svelte/icons/skip-forward';
  import Square from '@lucide/svelte/icons/square';
  import Timer from '@lucide/svelte/icons/timer';
  import type { CallRecord } from '@runlith/agent/callProgress';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import TimeLadder from '$lib/shared/ui/TimeLadder.svelte';
  import { Button, buttonVariants } from '$lib/shared/ui/button/index.js';
  import { WallClock } from '$lib/features/workspace/WallClock.svelte.js';
  import { CallActivity } from './CallActivity.svelte.js';

  let { call, awaited = false }: { call: CallRecord; awaited?: boolean } = $props();

  const activity = CallActivity.use();
  const clock = WallClock.use();
  const busy = $derived(activity.actOf(call));
  const said = $derived(activity.saidOf(call));
  const inBackground = $derived(call.mode === 'background');
  const stopping = $derived(call.phase === 'stopping');
  const standing = $derived(call.expiresAt === null || call.admittedAt === null ? null : call.expiresAt - call.admittedAt);
  const elapsed = $derived(call.admittedAt === null ? 0 : Math.max(0, clock.now - call.admittedAt));

  $effect(() => (call.admittedAt !== null && !awaited ? clock.watch() : undefined));

  async function limit(milliseconds: number): Promise<string | null> {
    await activity.control(call, { action: 'limit', milliseconds });
    return null;
  }
</script>

<div class="flex min-w-0 flex-wrap items-center gap-1 text-small text-muted-foreground">
  {#if awaited}
    <Tooltip text="Stop waiting — the agent takes its turn back and the command keeps running">
      <Button
        variant="ghost"
        size="icon-xs"
        class="size-6"
        disabled={busy !== null || stopping}
        aria-label="Stop waiting"
        onclick={() => void activity.control(call, { action: 'stop' })}
      >
        {#if busy === 'stop'}<Waiting class="size-3" />{:else}<SkipForward class="size-3" />{/if}
      </Button>
    </Tooltip>
  {:else}
    <Tooltip text="Stop this invocation and what it holds — its run continues">
      <Button
        variant="ghost"
        size="icon-xs"
        class="size-6 hover:bg-hover-danger hover:text-destructive"
        disabled={busy !== null || stopping}
        aria-label="Stop this invocation"
        onclick={() => void activity.control(call, { action: 'stop' })}
      >
        {#if busy === 'stop'}<Waiting class="size-3" />{:else}<Square class="size-3" />{/if}
      </Button>
    </Tooltip>
    {#if call.detachable && !inBackground && !stopping}
      <Tooltip
        text={call.admittedAt === null
          ? 'Continue in the background — it is prepared, asks any permission it needs and runs there'
          : 'Continue in the background — the work goes on'}
      >
        <Button
          variant="ghost"
          size="icon-xs"
          class="size-6"
          disabled={busy !== null}
          aria-label="Hand this invocation to the background"
          onclick={() => void activity.control(call, { action: 'background' })}
        >
          {#if busy === 'background'}<Waiting class="size-3" />{:else}<ArrowDownToLine class="size-3" />{/if}
        </Button>
      </Tooltip>
    {/if}
    <Tooltip text={call.admittedAt === null ? 'Available once the invocation is admitted to run' : 'Change how long it may run'}>
      <TimeLadder
        title="Time limit"
        label="Change how long this invocation may run"
        elapsedMs={elapsed}
        limitMs={standing}
        ceilingMs={call.limitCeilingMs}
        originAt={call.admittedAt}
        disabled={busy !== null || stopping || call.admittedAt === null}
        pick={limit}
        class={[buttonVariants({ variant: 'quiet', size: 'icon-xs' }), 'size-6']}
      >
        {#if busy === 'limit'}<Waiting class="size-3" />{:else}<Timer class="size-3" />{/if}
      </TimeLadder>
    </Tooltip>
  {/if}
  {#if said !== null && said !== ''}
    <span class="min-w-0 basis-full break-words text-muted-foreground/70" role="status">{said}</span>
  {/if}
</div>
