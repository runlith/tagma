<script lang="ts">
  import type { TeamModel } from '@runlith/agent/collaboration/team';
  import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';
  import type { ThreadWrites } from '../ThreadWrites.js';
  import ProviderHeading from './ProviderHeading.svelte';
  import ProviderMark from '$lib/features/providers/Mark.svelte';
  import RowLabel from './RowLabel.svelte';
  import type { TeamView } from './view.js';
  import { providerOn, rowKey, rowOn } from './edits.js';

  let { team, writes, onedit }: { team: TeamView; writes: ThreadWrites; onedit: () => void } = $props();

  const rows = $derived(team.read?.team.models ?? []);
  const off = $derived(team.read?.team.off ?? []);
  const edits = $derived(team.layer?.models ?? []);

  const groups = $derived(
    [...new Set(rows.map((row) => row.provider))].map((provider) => ({
      provider,
      on: providerOn(edits, provider, !off.includes(provider)),
      rows: rows.filter((row) => row.provider === provider),
    })),
  );

  function toggleRow(row: TeamModel, on: boolean): void {
    void writes.applyTeam(() => team.edit({ provider: row.provider, model: row.model, reasoning: row.reasoning, on }));
  }

  function toggleProvider(provider: string, on: boolean): void {
    void writes.applyTeam(() => team.edit({ provider, on }));
  }
</script>

{#each groups as group, index (group.provider)}
  {#if index > 0}<DropdownMenu.Separator />{/if}
  <DropdownMenu.CheckboxItem
    class="font-medium"
    closeOnSelect={false}
    bind:checked={() => group.on, (on) => toggleProvider(group.provider, on)}
  >
    {#snippet lead()}<ProviderMark provider={group.provider} titled={false} class="size-3.5" />{/snippet}
    <ProviderHeading provider={group.provider} />
  </DropdownMenu.CheckboxItem>
  {#each group.rows as row (rowKey(row))}
    <DropdownMenu.CheckboxItem
      class={group.on ? undefined : 'text-muted-foreground'}
      closeOnSelect={false}
      bind:checked={() => rowOn(edits, row), (on) => toggleRow(row, on)}
      data-team-row={rowKey(row)}
    >
      {#snippet lead()}<ProviderMark provider={row.provider} titled={false} class="size-3.5" />{/snippet}
      <RowLabel {row} />
    </DropdownMenu.CheckboxItem>
  {/each}
{:else}
  <DropdownMenu.Note text="No connected provider lists a model for sub-agents." />
{/each}
<DropdownMenu.Separator />
<DropdownMenu.Item icon={SlidersHorizontal} onSelect={onedit}>Edit list…</DropdownMenu.Item>
