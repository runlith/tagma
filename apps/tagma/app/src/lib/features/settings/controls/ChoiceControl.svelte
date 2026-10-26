<script lang="ts">
  import type { SettingChoice } from '@tagma/server/platform/contract/wire/setting';
  import { stepRadio } from '$lib/features/settings/controls/radiogroup.js';
  import * as Select from '$lib/shared/ui/select/index.js';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';

  const OPTIONS_WORTH_A_ROW = 4;

  let {
    label,
    choices,
    value,
    fallback,
    describedBy,
    disabled = false,
    onwrite,
  }: {
    label: string;
    choices: readonly SettingChoice[];
    value: unknown;
    fallback?: unknown;
    describedBy?: string;
    disabled?: boolean;
    onwrite: (value: string) => void;
  } = $props();

  const current = $derived(String(value ?? ''));
  const chosen = $derived(choices.find((choice) => choice.value === current));
  const shipped = $derived(fallback === undefined ? null : String(fallback));
  const inline = $derived(choices.length <= OPTIONS_WORTH_A_ROW);

  function optionTitle(choice: SettingChoice): string {
    return choice.value === shipped ? `${choice.hint} · Tagma default` : choice.hint;
  }
</script>

<div class={['grid min-w-0 max-w-full', inline ? '@xl/settings:min-w-72' : 'w-72']}>
  {#if inline}
    <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
    <div
      role="radiogroup"
      aria-label={label}
      aria-describedby={describedBy}
      tabindex={-1}
      class="flex min-w-0 overflow-hidden rounded-lg border"
      onkeydown={stepRadio}
    >
      {#each choices as choice, index (choice.value)}
        {@const here = choice.value === current}
        <Tooltip text={optionTitle(choice)} class="min-w-0 flex-1">
          <button
            type="button"
            role="radio"
            aria-checked={here}
            tabindex={here ? 0 : -1}
            class="relative w-full truncate px-3 py-1.5 text-center text-small transition-colors disabled:opacity-50 {here
              ? 'bg-primary text-primary-foreground'
              : 'hover:bg-hover'}"
            class:border-l={index > 0}
            {disabled}
            onclick={() => onwrite(choice.value)}
          >
            {choice.label}
            {#if choice.value === shipped}
              <span class="absolute inset-x-1.5 bottom-0.5 h-px bg-brand"></span>
            {/if}
          </button>
        </Tooltip>
      {/each}
    </div>
  {:else}
    <Select.Root value={current} {disabled} onValueChange={(picked) => onwrite(picked)}>
      <Tooltip text={chosen?.label} class="block min-w-0">
        <Select.Trigger class="w-full" aria-label={label} aria-describedby={describedBy}>
          <span class="min-w-0 truncate text-foreground">{chosen?.label ?? current}</span>
        </Select.Trigger>
      </Tooltip>
      <Select.Content>
        {#each choices as choice (choice.value)}
          <Select.Item value={choice.value} label={choice.label} title={optionTitle(choice)}>
            <span class="flex min-w-0 flex-1 items-center gap-2">
              <span class="min-w-0 truncate">{choice.label}</span>
              {#if choice.value === shipped}
                <span class="eyebrow shrink-0 text-muted-foreground/70">Default</span>
              {/if}
            </span>
          </Select.Item>
        {/each}
      </Select.Content>
    </Select.Root>
  {/if}
</div>
