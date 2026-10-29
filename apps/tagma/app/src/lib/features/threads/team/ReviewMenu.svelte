<script lang="ts">
  import { NO_REVIEW, REVIEW_LENSES, REVIEW_SPLITS, REVIEWERS_MAX, type ReviewPolicy } from '@runlith/agent/collaboration/team';
  import Copy from '@lucide/svelte/icons/copy';
  import Dot from '@lucide/svelte/icons/dot';
  import ListChecks from '@lucide/svelte/icons/list-checks';
  import ScanEye from '@lucide/svelte/icons/scan-eye';
  import Users from '@lucide/svelte/icons/users';
  import ProviderMark from '$lib/features/providers/Mark.svelte';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';
  import type { ThreadWrites } from '../ThreadWrites.js';
  import ModelLines from './ModelLines.svelte';
  import ProviderHeading from './ProviderHeading.svelte';
  import RowLabel from './RowLabel.svelte';
  import Stepper from './Stepper.svelte';
  import type { TeamView } from './view.js';
  import { pooled, poolRows, rowKey, withLens, withPool, withPooled } from './edits.js';
  import { LENS_WORDS } from './words.js';

  let { team, writes }: { team: TeamView; writes: ThreadWrites } = $props();

  const rows = $derived(team.read?.team.models ?? []);
  const policy = $derived(team.layer?.review ?? team.read?.team.review ?? NO_REVIEW);
  const order = $derived(poolRows(policy, rows));
  const groups = $derived(
    [...new Set(rows.map((row) => row.provider))].map((provider) => ({ provider, rows: rows.filter((row) => row.provider === provider) })),
  );

  function change(next: ReviewPolicy): void {
    void writes.applyTeam(() => team.review(next));
  }

  function count(by: number): void {
    const reviewers = Math.max(0, Math.min(REVIEWERS_MAX, policy.reviewers + by));
    if (reviewers !== policy.reviewers) change({ ...policy, reviewers });
  }

  function step(event: KeyboardEvent): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    count(event.key === 'ArrowRight' ? 1 : -1);
  }

  function split(value: string): void {
    const next = REVIEW_SPLITS.find((one) => one === value);
    if (next !== undefined && next !== policy.split) change({ ...policy, split: next });
  }
</script>

<DropdownMenu.Item icon={Users} closeOnSelect={false} textValue="Reviewers" onkeydown={step}>
  Reviewers
  {#snippet tail()}
    <Stepper
      label="Reviewers"
      value={policy.reviewers}
      minimum={0}
      maximum={REVIEWERS_MAX}
      tabindex={-1}
      onchange={(reviewers) => change({ ...policy, reviewers })}
    />
  {/snippet}
</DropdownMenu.Item>

{#if policy.reviewers > 0}
  <DropdownMenu.Separator />
  {#if order.length > 0}
    <DropdownMenu.Label>In order of preference</DropdownMenu.Label>
    {#each order as row (rowKey(row))}
      <DropdownMenu.CheckboxItem
        closeOnSelect={false}
        bind:checked={() => true, () => change(withPooled(policy, row))}
        data-team-row={rowKey(row)}
      >
        {#snippet lead()}<ProviderMark provider={row.provider} titled={false} class="size-3.5" />{/snippet}
        <RowLabel {row} named />
      </DropdownMenu.CheckboxItem>
    {/each}
  {:else}
    <DropdownMenu.Note text="No model is chosen, so nobody reviews." />
  {/if}
  {#if groups.length > 0}
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger icon={ListChecks} data-team-go="review-models">Choose models</DropdownMenu.SubTrigger>
      <DropdownMenu.SubContent class="w-72">
        {#each groups as group, index (group.provider)}
          {#if index > 0}<DropdownMenu.Separator />{/if}
          <DropdownMenu.Label>
            {#snippet lead()}<ProviderMark provider={group.provider} titled={false} class="size-3.5" />{/snippet}
            <ProviderHeading provider={group.provider} />
          </DropdownMenu.Label>
          <ModelLines
            rows={group.rows}
            lit={(row) => pooled(policy, row)}
            onturn={(targets, on) => change(withPool(policy, targets, on))}
          />
        {/each}
      </DropdownMenu.SubContent>
    </DropdownMenu.Sub>
  {/if}

  {#if policy.reviewers > 1}
    <DropdownMenu.Separator />
    <DropdownMenu.Label>Split</DropdownMenu.Label>
    <DropdownMenu.RadioGroup bind:value={() => policy.split, split}>
      <DropdownMenu.RadioItem value="same" icon={Copy} closeOnSelect={false}>Same brief for each</DropdownMenu.RadioItem>
      <DropdownMenu.RadioItem value="lenses" icon={ScanEye} closeOnSelect={false}>A lens for each</DropdownMenu.RadioItem>
    </DropdownMenu.RadioGroup>
    {#if policy.split === 'lenses'}
      {#each REVIEW_LENSES as lens (lens)}
        <DropdownMenu.CheckboxItem
          icon={Dot}
          closeOnSelect={false}
          bind:checked={() => policy.lenses.includes(lens), () => change(withLens(policy, lens))}
        >
          {LENS_WORDS[lens]}
        </DropdownMenu.CheckboxItem>
      {/each}
    {/if}
  {/if}
{/if}
