<script lang="ts">
  import { Input } from '$lib/shared/ui/input/index.js';
  import { percentOf, shareOf } from '$lib/features/settings/controls/units.js';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';

  const THOUSAND = 1000;

  let {
    label,
    value,
    minimum,
    maximum,
    fallback,
    reference,
    disabled = false,
    onwrite,
  }: {
    label: string;
    value: unknown;
    minimum: number;
    maximum: number;
    fallback: unknown;
    reference?: { readonly ceiling: number; readonly of: string };
    disabled?: boolean;
    onwrite: (value: number) => void;
  } = $props();

  const stored = $derived(percentOf(Number(value)));
  const floor = $derived(percentOf(minimum));
  const ceiling = $derived(percentOf(maximum));

  let dragged = $state<number | null>(null);
  const percent = $derived(dragged ?? stored);

  $effect(() => {
    void stored;
    dragged = null;
  });

  const markAt = $derived(((percentOf(Number(fallback)) - floor) / (ceiling - floor)) * 100);
  const filled = $derived(((percent - floor) / (ceiling - floor)) * 100);
  const holds = $derived(reference === undefined ? null : Math.round((shareOf(percent) * reference.ceiling) / THOUSAND));

  function write(typed: number): void {
    if (!Number.isFinite(typed)) return;
    const bounded = Math.min(ceiling, Math.max(floor, Math.round(typed)));
    onwrite(shareOf(bounded));
  }
</script>

<div class="grid w-52 shrink-0 gap-1">
  <div class="flex items-center gap-2">
    <div class="relative flex-1">
      <input
        type="range"
        class="knob w-full cursor-pointer disabled:cursor-default"
        style="--filled: {filled}%"
        aria-label={label}
        min={floor}
        max={ceiling}
        step={1}
        value={percent}
        {disabled}
        oninput={(event) => (dragged = Number((event.currentTarget as HTMLInputElement).value))}
        onchange={(event) => write(Number((event.currentTarget as HTMLInputElement).value))}
      />
      {#if markAt >= 0 && markAt <= 100}
        <Tooltip text="Tagma default" class="absolute bottom-0 h-1.5 w-px" style="left: {markAt}%">
          <span class="pointer-events-none block h-full w-full bg-brand"></span>
        </Tooltip>
      {/if}
    </div>
    <div class="flex items-center gap-1">
      <Input
        class="w-14 text-right font-mono"
        type="number"
        inputmode="numeric"
        min={floor}
        max={ceiling}
        step={1}
        value={String(percent)}
        {disabled}
        onchange={(event) => write(Number((event.currentTarget as HTMLInputElement).value))}
      />
      <span class="text-small text-muted-foreground">%</span>
    </div>
  </div>
  {#if holds !== null && reference}
    <p class="text-right text-small text-muted-foreground">
      ≈ {holds}k tokens of a {reference.ceiling / THOUSAND}k {reference.of}
    </p>
  {/if}
</div>
