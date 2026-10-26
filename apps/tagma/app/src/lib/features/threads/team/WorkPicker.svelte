<script lang="ts">
  import { TEAM_WORK, type TeamWork } from '@runlith/llm/models/description';
  import FadeText from '$lib/shared/FadeText.svelte';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';

  let {
    label,
    value,
    disabled = false,
    onchange,
  }: { label: string; value: readonly TeamWork[]; disabled?: boolean; onchange: (value: readonly TeamWork[]) => void } = $props();

  function toggle(work: TeamWork): void {
    onchange(value.includes(work) ? value.filter((one) => one !== work) : TEAM_WORK.filter((one) => one === work || value.includes(one)));
  }
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger
    class="max-w-32 min-w-10 rounded-md border border-vein px-1.5 py-0.5 text-left text-small transition-colors hover:bg-hover disabled:opacity-50"
    aria-label={label}
    {disabled}
  >
    {#if value.length === 0}<span class="text-muted-foreground">—</span>{:else}<FadeText text={value.join(', ')} />{/if}
  </DropdownMenu.Trigger>
  <DropdownMenu.Content align="start" class="w-44">
    {#each TEAM_WORK as work (work)}
      <DropdownMenu.CheckboxItem closeOnSelect={false} bind:checked={() => value.includes(work), () => toggle(work)}>
        {work}
      </DropdownMenu.CheckboxItem>
    {/each}
  </DropdownMenu.Content>
</DropdownMenu.Root>
