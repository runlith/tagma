<script lang="ts" generics="Value extends string">
  let {
    label,
    choices,
    value,
    wide = false,
    disabled = false,
    onchange,
  }: {
    label: string;
    choices: readonly { readonly value: Value; readonly label: string }[];
    value: Value;
    wide?: boolean;
    disabled?: boolean;
    onchange: (value: Value) => void;
  } = $props();
</script>

<span class={['rounded-md bg-sunken p-0.5', wide ? 'flex' : 'inline-flex']} role="group" aria-label={label}>
  {#each choices as choice (choice.value)}
    <button
      type="button"
      class={[
        'rounded-sm px-2 py-0.5 text-small font-medium transition-colors disabled:opacity-60',
        wide && 'flex-1',
        choice.value === value ? 'bg-selected text-foreground' : 'text-muted-foreground hover:text-foreground',
      ]}
      aria-pressed={choice.value === value}
      {disabled}
      onclick={() => onchange(choice.value)}
    >
      {choice.label}
    </button>
  {/each}
</span>
