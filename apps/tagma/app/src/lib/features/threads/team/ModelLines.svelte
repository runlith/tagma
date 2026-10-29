<script lang="ts">
  import type { TeamModel } from '@runlith/agent/collaboration/team';
  import { ProviderCatalog } from '$lib/features/providers/Catalog.svelte.js';
  import Rungs from '$lib/shared/models/Rungs.svelte';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';
  import { type ModelLine, modelLines } from './words.js';

  let {
    rows,
    lit,
    onturn,
  }: {
    rows: readonly TeamModel[];
    lit: (row: TeamModel) => boolean;
    onturn: (rows: readonly TeamModel[], on: boolean) => void;
  } = $props();

  const catalog = ProviderCatalog.use();

  const lines = $derived(
    modelLines(catalog.models, rows).map((line) => ({ ...line, lit: line.rows.filter((one) => lit(one.row)).length })),
  );

  const rowsOf = (line: ModelLine<TeamModel>): readonly TeamModel[] => line.rows.map((one) => one.row);

  function turnStep(line: ModelLine<TeamModel>, step: string): void {
    const row = line.rows.find((one) => one.step?.id === step)?.row;
    if (row !== undefined) onturn([row], !lit(row));
  }
</script>

{#each lines as line (line.key)}
  {@const all = line.lit === line.rows.length}
  {#if line.rows.some((one) => one.step !== null)}
    <DropdownMenu.CheckboxItem
      closeOnSelect={false}
      indeterminate={line.lit > 0 && !all}
      bind:checked={() => all, (on) => onturn(rowsOf(line), on)}
      textValue={line.label}
      data-team-line={line.key}
    >
      <span class={line.lit === 0 ? 'text-muted-foreground' : undefined}>{line.label}</span>
      {#snippet tail()}
        <Rungs
          steps={line.rows.flatMap((one) => (one.step === null ? [] : [one.step]))}
          model={line.label}
          pressed={(step) => line.rows.some((one) => one.step?.id === step && lit(one.row))}
          onpress={(step) => turnStep(line, step)}
        />
      {/snippet}
    </DropdownMenu.CheckboxItem>
  {:else}
    <DropdownMenu.CheckboxItem
      closeOnSelect={false}
      bind:checked={() => all, (on) => onturn(rowsOf(line), on)}
      textValue={line.label}
      data-team-line={line.key}
    >
      <span class={line.lit === 0 ? 'text-muted-foreground' : undefined}>{line.label}</span>
    </DropdownMenu.CheckboxItem>
  {/if}
{/each}
