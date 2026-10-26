<script lang="ts">
  import type { SettingChoice } from '@tagma/server/platform/contract/wire/setting';
  import Check from '@lucide/svelte/icons/check';
  import { cn } from '$lib/shared/utils.js';

  let {
    label,
    choices,
    value,
    fallback,
    disabled = false,
    onwrite,
  }: {
    label: string;
    choices: readonly SettingChoice[];
    value: unknown;
    fallback?: unknown;
    disabled?: boolean;
    onwrite: (value: readonly string[]) => void;
  } = $props();

  const listOf = (raw: unknown): string[] => (Array.isArray(raw) ? raw.filter((one): one is string => typeof one === 'string') : []);

  const current = $derived(new Set(listOf(value)));
  const shipped = $derived(new Set(fallback === undefined ? [] : listOf(fallback)));

  function toggle(picked: string): void {
    const next = new Set(current);
    if (!next.delete(picked)) next.add(picked);
    onwrite(choices.flatMap((choice) => (next.has(choice.value) ? [choice.value] : [])));
  }
</script>

<div class="grid w-72 min-w-0 max-w-full gap-1" role="group" aria-label={label}>
  {#each choices as choice (choice.value)}
    {@const here = current.has(choice.value)}
    <button
      type="button"
      role="checkbox"
      aria-checked={here}
      {disabled}
      class={cn(
        'flex min-w-0 items-start gap-2 rounded-lg border px-2 py-1.5 text-left transition-colors',
        here ? 'border-brand/40 bg-brand/5' : 'hover:bg-hover',
        disabled && 'pointer-events-none opacity-60',
      )}
      onclick={() => toggle(choice.value)}
    >
      <span
        class={cn(
          'mt-1 grid size-3.5 shrink-0 place-items-center rounded-sm border',
          here ? 'border-brand bg-brand text-primary-foreground' : 'border-input',
        )}
      >
        {#if here}<Check class="size-3" />{/if}
      </span>
      <span class="min-w-0 flex-1">
        <span class="block text-small leading-5">
          {choice.label}
          {#if shipped.has(choice.value)}<span class="stamp text-muted-foreground/60"> · Tagma default</span>{/if}
        </span>
        {#if choice.hint}
          <span class="block text-small leading-4 text-muted-foreground">{choice.hint}</span>
        {/if}
      </span>
    </button>
  {/each}
</div>
