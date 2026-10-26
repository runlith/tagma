<script lang="ts">
  import type { ModelStatus } from '@tagma/server/speech/contract/wire/status';

  type Tuning = ModelStatus['tuning'][number];

  let { knob, value, onwrite }: { knob: Tuning; value: number; onwrite: (value: number) => void } = $props();

  const span = $derived(knob.max - knob.min);
  const step = $derived(Number.isInteger(knob.min) && Number.isInteger(knob.max) && span >= 20 ? 1 : span / 100);
</script>

<div class="flex items-center gap-3">
  <input
    type="range"
    class="min-w-0 flex-1 accent-foreground"
    aria-label={knob.label}
    min={knob.min}
    max={knob.max}
    {step}
    {value}
    onchange={(event) => onwrite(Number(event.currentTarget.value))}
  />
  <span class="w-12 shrink-0 text-right text-small tabular-nums text-muted-foreground">{value}</span>
</div>
{#if value !== knob.initial}
  <button
    type="button"
    class="justify-self-start text-small text-muted-foreground underline-offset-4 hover:underline"
    onclick={() => onwrite(knob.initial)}
  >
    Reset to {knob.initial}
  </button>
{/if}
