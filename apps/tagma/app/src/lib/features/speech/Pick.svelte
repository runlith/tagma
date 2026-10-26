<script lang="ts">
  import * as Select from '$lib/shared/ui/select/index.js';

  export type Option = {
    readonly value: string;
    readonly label: string;
    readonly note?: string;
    readonly disabled?: boolean;
  };

  let {
    label,
    value,
    options,
    disabled = false,
    onwrite,
  }: {
    label: string;
    value: string;
    options: readonly Option[];
    disabled?: boolean;
    onwrite: (value: string) => void;
  } = $props();

  const chosen = $derived(options.find((option) => option.value === value));
</script>

<Select.Root {value} {disabled} onValueChange={(picked) => onwrite(picked)}>
  <Select.Trigger class="w-full" aria-label={label}>
    <span class="min-w-0 truncate text-foreground">{chosen?.label ?? value}</span>
  </Select.Trigger>
  <Select.Content>
    {#each options as option (option.value)}
      <Select.Item value={option.value} label={option.label} disabled={option.disabled ?? false}>
        <span class="flex min-w-0 flex-1 items-center gap-2">
          <span class="min-w-0 truncate">{option.label}</span>
          {#if option.note}
            <span class="shrink-0 text-small text-muted-foreground">{option.note}</span>
          {/if}
        </span>
      </Select.Item>
    {/each}
  </Select.Content>
</Select.Root>
