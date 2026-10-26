<script lang="ts">
  let {
    label,
    value,
    disabled = false,
    small = false,
    onwrite,
  }: {
    label: string;
    value: boolean;
    disabled?: boolean;
    small?: boolean;
    onwrite: (value: boolean) => void;
  } = $props();
</script>

<button
  type="button"
  role="switch"
  aria-checked={value}
  aria-label={label}
  class={[
    'relative shrink-0 rounded-full transition-colors disabled:opacity-50',
    small ? 'h-3.5 w-6 align-middle' : 'h-5 w-9',
    value ? 'bg-primary' : 'bg-border',
  ]}
  {disabled}
  onclick={() => onwrite(!value)}
>
  {#if small}
    <span class="absolute top-0.5 size-2.5 rounded-full bg-background transition-[left] {value ? 'left-3' : 'left-0.5'}"></span>
  {:else}
    <span class="absolute top-0.5 size-4 rounded-full bg-background transition-[left] {value ? 'left-4.5' : 'left-0.5'}"></span>
  {/if}
</button>
