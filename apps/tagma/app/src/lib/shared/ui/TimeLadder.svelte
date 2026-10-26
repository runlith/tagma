<script lang="ts" module>
  const MINUTE = 60_000;
  const HOUR = 60 * MINUTE;
  const STEPS = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240].map((minutes) => minutes * MINUTE);

  export function rungsOf(limitMs: number | null, ceilingMs: number | null): readonly number[] {
    const kept = STEPS.filter((step) => ceilingMs === null || step <= ceilingMs);
    const tops = ceilingMs !== null && ceilingMs < STEPS[STEPS.length - 1]! ? [ceilingMs] : [];
    return [...new Set([...kept, ...tops, ...(limitMs === null ? [] : [limitMs])])].sort((a, b) => a - b);
  }

  function rungWord(ms: number): string {
    if (ms >= HOUR && ms % (HOUR / 2) === 0) return `${ms / HOUR}h`;
    if (ms % MINUTE === 0) return `${ms / MINUTE}m`;
    return formatSpan(ms);
  }

  function spanWord(ms: number): string {
    if (ms >= HOUR && ms % (HOUR / 2) === 0) return `${ms / HOUR} h`;
    if (ms % MINUTE === 0) return `${ms / MINUTE} min`;
    return formatSpan(ms);
  }

  const CLOCK = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { ClassValue } from 'svelte/elements';
  import { formatLimit, formatSpan } from '$lib/shared/figures.js';
  import * as Popover from './popover/index.js';

  let {
    title,
    label,
    elapsedMs,
    limitMs,
    ceilingMs,
    originAt,
    disabled = false,
    pick,
    class: className,
    children,
  }: {
    title: string;
    label: string;
    elapsedMs: number;
    limitMs: number | null;
    ceilingMs: number | null;
    originAt: number | null;
    disabled?: boolean;
    pick: (ms: number) => Promise<string | null>;
    class?: ClassValue;
    children: Snippet;
  } = $props();

  let open = $state(false);
  let aim = $state<number | null>(null);
  let busy = $state(false);
  let refusal = $state<string | null>(null);
  let row = $state<HTMLDivElement>();

  const rungs = $derived(rungsOf(limitMs, ceilingMs));

  function at(ms: number): string {
    return originAt === null ? '' : CLOCK.format(originAt + ms);
  }

  const footer = $derived.by(() => {
    if (busy) return 'Changing…';
    if (refusal !== null) return refusal;
    if (aim !== null && aim !== limitMs) {
      const until = originAt === null ? '' : `Until ${at(aim)}, `;
      if (limitMs === null) return `${until}${spanWord(aim)} in all.`;
      return `${until}${spanWord(Math.abs(aim - limitMs))} ${aim > limitMs ? 'longer' : 'shorter'}.`;
    }
    if (limitMs === null) return 'No time limit.';
    return originAt === null ? `${spanWord(limitMs)} in all.` : `Stops at ${at(limitMs)} unless it ends first.`;
  });

  function fill(rung: number): string {
    if (rung <= elapsedMs) return 'bg-muted-foreground/40';
    if (rung === limitMs) return aim !== null && aim !== limitMs ? 'bg-muted-foreground' : 'bg-foreground';
    if (aim !== null && aim !== limitMs && (rung === aim || (limitMs !== null && aim > limitMs && rung > limitMs && rung < aim)))
      return 'bg-foreground';
    if (limitMs !== null && rung < limitMs) return 'bg-vein-strong';
    return 'bg-vein';
  }

  async function choose(rung: number): Promise<void> {
    if (busy) return;
    if (rung === limitMs) {
      open = false;
      return;
    }
    busy = true;
    refusal = null;
    const said = await pick(rung);
    busy = false;
    refusal = said;
    if (said === null) open = false;
  }

  function step(event: KeyboardEvent): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const buttons = [...(row?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
    const next = buttons[buttons.indexOf(document.activeElement as HTMLButtonElement) + (event.key === 'ArrowRight' ? 1 : -1)];
    if (next === undefined) return;
    event.preventDefault();
    next.focus();
  }

  function opened(next: boolean): void {
    open = next;
    aim = null;
    if (next) refusal = null;
  }
</script>

<Popover.Root {open} onOpenChange={opened}>
  <Popover.Trigger
    class={className}
    aria-label={label}
    {disabled}
    onclick={(event) => event.stopPropagation()}
    onkeydown={(event) => event.stopPropagation()}
    data-time-ladder
  >
    {@render children()}
  </Popover.Trigger>
  <Popover.Content
    align="start"
    collisionPadding={12}
    class="w-96 gap-3 p-3"
    initialFocus={() =>
      row?.querySelector<HTMLElement>('[aria-pressed="true"]:not(:disabled)') ??
      row?.querySelector<HTMLElement>('button:not(:disabled)') ??
      null}
  >
    <div class="flex items-baseline justify-between gap-3">
      <span class="font-medium">{title}</span>
      <span class="text-small text-muted-foreground tabular-nums">
        {formatSpan(elapsedMs)}{limitMs === null ? ', no limit' : ` of ${formatLimit(limitMs)}`}
      </span>
    </div>
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div bind:this={row} class="flex gap-0.5" role="group" aria-label={title} onkeydown={step} onmouseleave={() => (aim = null)}>
      {#each rungs as rung (rung)}
        {@const past = rung <= elapsedMs}
        <button
          type="button"
          class="group/rung grid min-w-0 flex-1 cursor-pointer justify-items-center gap-1 outline-none disabled:cursor-default"
          disabled={past || busy}
          aria-pressed={rung === limitMs}
          aria-label={spanWord(rung)}
          onmouseenter={() => (aim = past ? null : rung)}
          onfocus={() => (aim = past ? null : rung)}
          onclick={() => void choose(rung)}
        >
          <span class={['h-4 w-full transition-colors group-focus-visible/rung:ring-2 group-focus-visible/rung:ring-ring', fill(rung)]}
          ></span>
          <span
            class={[
              'text-meta tabular-nums',
              past ? 'text-muted-foreground/40' : rung === limitMs || rung === aim ? 'text-foreground' : 'text-muted-foreground',
            ]}>{rungWord(rung)}</span
          >
        </button>
      {/each}
    </div>
    <p class={['text-small tabular-nums', refusal !== null && !busy ? 'text-destructive' : 'text-muted-foreground']} role="status">
      {footer}
    </p>
  </Popover.Content>
</Popover.Root>
