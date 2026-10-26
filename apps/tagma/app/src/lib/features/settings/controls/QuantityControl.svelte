<script lang="ts">
  import type { SettingUnit } from '@tagma/server/platform/contract/wire/setting';
  import { Input } from '$lib/shared/ui/input/index.js';
  import { stepRadio } from '$lib/features/settings/controls/radiogroup.js';
  import { rawOf, scaleOf, unitsOf } from '@tagma/server/settings/contract/wire/units';

  let {
    label,
    value,
    unit,
    minimum,
    maximum,
    step,
    disabled = false,
    onwrite,
  }: {
    label: string;
    value: unknown;
    unit: SettingUnit;
    minimum: number;
    maximum?: number;
    step: number;
    disabled?: boolean;
    onwrite: (value: number) => void;
  } = $props();

  const units = $derived(unitsOf(unit));
  const scaled = $derived(scaleOf(unit, Number(value)));
  let chosen = $state<string | null>(null);
  const shownUnit = $derived(chosen ?? scaled.unit);
  const shown = $derived(chosen === null ? scaled.shown : trimmed(Number(value) / rawOf(unit, 1, chosen)));

  function trimmed(figure: number): number {
    return Math.round(figure * 100) / 100;
  }

  function write(typed: number): void {
    if (!Number.isFinite(typed)) return;
    const raw = rawOf(unit, typed, shownUnit);
    const bounded = Math.min(maximum ?? Number.MAX_SAFE_INTEGER, Math.max(minimum, raw));
    onwrite(bounded);
  }
</script>

<div class="flex shrink-0 items-center gap-1.5">
  <Input
    class="w-24 text-right font-mono"
    type="number"
    inputmode="decimal"
    aria-label={label}
    min={0}
    step={shownUnit === units[units.length - 1] ? step : 'any'}
    value={String(shown)}
    {disabled}
    onchange={(event) => write(Number((event.currentTarget as HTMLInputElement).value))}
  />
  {#if units.length > 1}
    <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
    <div
      role="radiogroup"
      aria-label="{label} unit"
      tabindex={-1}
      class="flex shrink-0 overflow-hidden rounded-lg border"
      onkeydown={stepRadio}
    >
      {#each units as name, index (name)}
        {@const here = shownUnit === name}
        <button
          type="button"
          role="radio"
          aria-checked={here}
          tabindex={here ? 0 : -1}
          class="min-w-7 px-1 py-1 text-center font-mono text-meta transition-colors disabled:opacity-50 {here
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:bg-hover hover:text-foreground'}"
          class:border-l={index > 0}
          {disabled}
          onclick={() => (chosen = name)}
        >
          {name}
        </button>
      {/each}
    </div>
  {:else}
    <span class="text-small text-muted-foreground">{shownUnit}</span>
  {/if}
</div>
