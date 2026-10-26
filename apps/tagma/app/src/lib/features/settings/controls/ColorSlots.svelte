<script lang="ts">
  import type { SettingColorGroup } from '@tagma/server/platform/contract/wire/setting';
  import { type ColorRecord, isColor, swatchOf, withColor } from '$lib/features/settings/controls/colors.js';
  import * as Popover from '$lib/shared/ui/popover/index.js';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';

  let {
    label,
    groups,
    value,
    disabled = false,
    onwrite,
  }: {
    label: string;
    groups: readonly SettingColorGroup[];
    value: ColorRecord;
    disabled?: boolean;
    onwrite: (value: ColorRecord) => void;
  } = $props();

  let typed = $state<Record<string, string>>({});

  const set = $derived(Object.keys(value).length);
  const shown = $derived(Object.values(value).slice(0, 6));

  function text(slot: string): string {
    return typed[slot] ?? value[slot] ?? '';
  }

  function wrong(slot: string): boolean {
    const draft = typed[slot];
    return draft !== undefined && draft.trim() !== '' && !isColor(draft);
  }

  function commit(slot: string, colour: string): void {
    if (colour.trim() !== '' && !isColor(colour)) {
      typed = { ...typed, [slot]: colour };
      return;
    }
    const { [slot]: settled, ...rest } = typed;
    typed = rest;
    onwrite(withColor(value, slot, colour));
  }
</script>

<div class="grid w-full gap-1.5 @xl/settings:w-72">
  <Popover.Root>
    <Popover.Trigger
      class="flex min-w-0 items-center gap-2 rounded-lg border px-2 py-1.5 text-small transition-colors hover:bg-hover disabled:opacity-50"
      aria-label={label}
      {disabled}
    >
      {#if shown.length > 0}
        <span class="flex shrink-0 overflow-hidden rounded-sm border border-vein">
          {#each shown as colour, index (index)}
            <span class="h-3.5 w-2.5" style="background-color: {colour}"></span>
          {/each}
        </span>
      {/if}
      <span class="min-w-0 flex-1 truncate text-left text-muted-foreground">
        {set === 0 ? 'None set' : set === 1 ? '1 slot set' : `${set} slots set`}
      </span>
    </Popover.Trigger>
    <Popover.Content align="end" class="w-80 p-0">
      <div class="grid max-h-96 gap-3 overflow-y-auto p-3">
        {#each groups as group (group.label)}
          <div class="grid gap-1">
            <p class="eyebrow text-muted-foreground">{group.label}</p>
            {#each group.slots as slot (slot.key)}
              <Tooltip text={slot.hint} class="block min-w-0">
                <div class="flex items-center gap-2">
                  <input
                    type="color"
                    class="size-6 shrink-0 cursor-pointer rounded-sm border border-vein bg-transparent p-0.5 disabled:cursor-default"
                    aria-label="{slot.label} swatch"
                    value={swatchOf(value[slot.key])}
                    {disabled}
                    onchange={(event) => commit(slot.key, (event.currentTarget as HTMLInputElement).value)}
                  />
                  <span class="min-w-0 flex-1 truncate text-small" class:text-muted-foreground={value[slot.key] === undefined}>
                    {slot.label}
                  </span>
                  <input
                    class="w-20 shrink-0 rounded-md border bg-transparent px-1.5 py-0.5 font-mono text-meta outline-none focus:border-ring"
                    class:border-destructive={wrong(slot.key)}
                    aria-label={slot.label}
                    placeholder="theme"
                    spellcheck="false"
                    value={text(slot.key)}
                    {disabled}
                    oninput={(event) => (typed = { ...typed, [slot.key]: (event.currentTarget as HTMLInputElement).value })}
                    onchange={(event) => commit(slot.key, (event.currentTarget as HTMLInputElement).value)}
                  />
                </div>
              </Tooltip>
            {/each}
          </div>
        {/each}
        <p class="text-small text-muted-foreground">
          An empty field leaves the slot to the theme. A hex is three or six digits behind a hash.
        </p>
      </div>
    </Popover.Content>
  </Popover.Root>
</div>
