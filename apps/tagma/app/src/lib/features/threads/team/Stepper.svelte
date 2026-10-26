<script lang="ts">
  import Minus from '@lucide/svelte/icons/minus';
  import Plus from '@lucide/svelte/icons/plus';

  let {
    label,
    value,
    minimum,
    maximum,
    disabled = false,
    tabindex,
    onchange,
  }: {
    label: string;
    value: number;
    minimum: number;
    maximum: number;
    disabled?: boolean;
    tabindex?: number;
    onchange: (value: number) => void;
  } = $props();

  const STEP =
    'grid size-5 place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-hover hover:text-foreground disabled:opacity-40';
</script>

<span class="inline-flex shrink-0 items-center" role="group" aria-label={label}>
  <button
    type="button"
    class={STEP}
    {tabindex}
    aria-label={`Fewer — ${label}`}
    disabled={disabled || value <= minimum}
    onclick={() => onchange(value - 1)}
  >
    <Minus class="size-3" />
  </button>
  <span class="min-w-5 text-center font-mono text-small font-medium tabular-nums" data-stepper={label}>{value}</span>
  <button
    type="button"
    class={STEP}
    {tabindex}
    aria-label={`More — ${label}`}
    disabled={disabled || value >= maximum}
    onclick={() => onchange(value + 1)}
  >
    <Plus class="size-3" />
  </button>
</span>
