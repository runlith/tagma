<script lang="ts">
  import Terminal from '@lucide/svelte/icons/terminal';
  import type { CommandView } from '$lib/features/executions/commands/Activity.svelte.js';
  import { Readings } from '$lib/features/executions/load/Readings.svelte.js';
  import { percent, threadWork } from '$lib/features/executions/load/rows.js';
  import { threadPeeks } from './threadPeek.svelte.js';
  import WorkPeek from './WorkPeek.svelte';

  let { threadId, anchor, processes }: { threadId: string; anchor: HTMLElement | null; processes: CommandView } = $props();

  const readings = Readings.use();
  const row = $derived(readings.agents.get(threadId));

  $effect(() => readings.hold());
  const work = $derived(threadWork(row));
  const count = $derived(work.length);
  const key = $derived(threadPeeks.workKey(threadId));
  const open = $derived(threadPeeks.openId === key);
  const label = $derived(
    row === undefined
      ? ''
      : `${count} live ${count === 1 ? 'command or terminal' : 'commands and terminals'}, ${percent(row.share)} of the machine's CPU — show them`,
  );

  let badge = $state<HTMLSpanElement | null>(null);
  let byKey = $state(false);

  function toggle(event: Event, keyed: boolean): void {
    event.preventDefault();
    event.stopPropagation();
    byKey = keyed;
    threadPeeks.toggle(key);
  }

  let shown = false;
  $effect(() => {
    if (open && anchor !== null && count > 0) {
      shown = true;
      return;
    }
    if (!shown) return;
    shown = false;
    if (open) threadPeeks.close(key);
  });
  $effect(() => {
    const standing = key;
    return () => {
      if (shown) threadPeeks.close(standing);
    };
  });
</script>

{#if row !== undefined && count > 0}
  <span
    bind:this={badge}
    class="inline-flex h-4.5 shrink-0 items-center gap-0.5 rounded-sm px-1 text-meta leading-none tabular text-muted-foreground transition-colors outline-none hover:bg-hover focus-visible:bg-selected data-[state=open]:bg-selected"
    role="button"
    tabindex="0"
    aria-label={label}
    aria-haspopup="dialog"
    aria-expanded={open}
    data-state={open ? 'open' : 'closed'}
    data-thread-load
    onclick={(event) => toggle(event, false)}
    onkeydown={(event) => {
      if (event.key === 'Enter' || event.key === ' ') toggle(event, true);
    }}
  >
    <Terminal class="block size-3 shrink-0" />{count > 99 ? '99+' : count}{#if row.share >= 0.01}<span class="opacity-60">·</span>{percent(
        row.share,
      )}{/if}
  </span>
  {#if open && anchor !== null}
    <WorkPeek {threadId} {row} {work} {processes} {anchor} {badge} peekKey={key} {byKey} />
  {/if}
{/if}
