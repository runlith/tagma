<script lang="ts" generics="Value extends string">
  import { Menu } from '@runlith/primitives/menu.svelte';
  import { untrack } from 'svelte';

  let {
    label,
    choices,
    chosen,
    disabled = false,
    inMenu = false,
    onpress,
  }: {
    label: string;
    choices: readonly { readonly value: Value; readonly label: string }[];
    chosen: (value: Value) => boolean;
    disabled?: boolean;
    inMenu?: boolean;
    onpress: (value: Value) => void;
  } = $props();

  const menu = untrack(() => inMenu) ? Menu.use() : null;
</script>

<span class="flex min-w-0 flex-wrap gap-1" role="group" aria-label={label}>
  {#each choices as choice (choice.value)}
    <button
      type="button"
      role={menu === null ? undefined : 'menuitemcheckbox'}
      class={[
        'rounded-full border px-2 py-0.5 text-meta font-medium transition-colors outline-hidden disabled:opacity-60 data-highlighted:bg-hover data-highlighted:text-foreground',
        chosen(choice.value) ? 'bg-selected text-foreground' : 'text-muted-foreground hover:text-foreground',
      ]}
      aria-pressed={menu === null ? chosen(choice.value) : undefined}
      aria-checked={menu === null ? undefined : chosen(choice.value)}
      {disabled}
      onclick={menu === null ? () => onpress(choice.value) : undefined}
      {@attach menu?.item(() => ({ disabled, textValue: choice.label, closeOnSelect: false, onSelect: () => onpress(choice.value) }))}
    >
      {choice.label}
    </button>
  {/each}
</span>
