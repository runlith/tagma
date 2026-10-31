<script lang="ts">
  import type { TeamModel } from '@runlith/agent/collaboration/team';
  import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
  import ProviderMark from '$lib/features/providers/Mark.svelte';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';
  import type { ThreadWrites } from '../ThreadWrites.js';
  import ModelLines from './ModelLines.svelte';
  import ProviderHeading from './ProviderHeading.svelte';
  import type { TeamView } from './view.js';
  import { providerOn, rowChecked } from './edits.js';

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

  function turn(targets: readonly TeamModel[], on: boolean): void {
    void writes.applyTeam(async () => {
      await Promise.all(targets.map((row) => team.edit({ provider: row.provider, model: row.model, reasoning: row.reasoning, on })));
    });
  }

  function turnProvider(provider: string, on: boolean): void {
    void writes.applyTeam(() => team.edit({ provider, on }));
  }
</script>

{#each groups as group, index (group.provider)}
  {#if index > 0}<DropdownMenu.Separator />{/if}
  <DropdownMenu.CheckboxItem
    class="font-medium"
    closeOnSelect={false}
    bind:checked={() => group.on, (on) => turnProvider(group.provider, on)}
    data-team-provider-row={group.provider}
  >
    {#snippet lead()}<ProviderMark provider={group.provider} titled={false} class="size-3.5" />{/snippet}
    <ProviderHeading provider={group.provider} />
  </DropdownMenu.CheckboxItem>
  {#if group.on}
    <ModelLines rows={group.rows} lit={(row) => rowChecked(edits, row, 'on')} onturn={turn} />
  {/if}
{:else}
  <DropdownMenu.Note text="No connected provider lists a model for sub-agents." />
{/each}
<DropdownMenu.Separator />
<DropdownMenu.Item icon={SlidersHorizontal} onSelect={onedit}>Edit list…</DropdownMenu.Item>
