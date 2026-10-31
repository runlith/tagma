<script lang="ts">
  import { NO_REVIEW, REVIEWERS_MAX, type ReviewPolicy, type TeamModel } from '@runlith/agent/collaboration/team';
  import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
  import Users from '@lucide/svelte/icons/users';
  import ProviderMark from '$lib/features/providers/Mark.svelte';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';
  import type { ThreadWrites } from '../ThreadWrites.js';
  import Chips from '$lib/shared/ui/Chips.svelte';
  import ModelLines from './ModelLines.svelte';
  import ProviderHeading from './ProviderHeading.svelte';
  import Stepper from './Stepper.svelte';
  import type { TeamView } from './view.js';
  import { providerOn, rowChecked, withLens } from './edits.js';
  import { LENS_CHOICES } from './words.js';

  let { team, writes, onedit }: { team: TeamView; writes: ThreadWrites; onedit: () => void } = $props();

  const rows = $derived(team.read?.team.models ?? []);
  const off = $derived(team.read?.team.off ?? []);
  const edits = $derived(team.layer?.models ?? []);
  const policy = $derived(team.layer?.review ?? team.read?.team.review ?? NO_REVIEW);
  const groups = $derived(
    [...new Set(rows.map((row) => row.provider))]
      .filter((provider) => providerOn(edits, provider, !off.includes(provider)))
      .map((provider) => ({ provider, rows: rows.filter((row) => row.provider === provider) })),
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

  function turn(targets: readonly TeamModel[], reviews: boolean): void {
    void writes.applyTeam(async () => {
      await Promise.all(targets.map((row) => team.edit({ provider: row.provider, model: row.model, reasoning: row.reasoning, reviews })));
    });
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

<DropdownMenu.Separator />
{#each groups as group (group.provider)}
  <DropdownMenu.Label>
    {#snippet lead()}<ProviderMark provider={group.provider} titled={false} class="size-3.5" />{/snippet}
    <ProviderHeading provider={group.provider} />
  </DropdownMenu.Label>
  <ModelLines rows={group.rows} lit={(row) => rowChecked(edits, row, 'reviews')} onturn={turn} />
{:else}
  <DropdownMenu.Note text="No connected provider lists a model for sub-agents." />
{/each}

<DropdownMenu.Separator />
<DropdownMenu.Label>Look at</DropdownMenu.Label>
<div class="px-2 pb-1.5">
  <Chips
    label="Look at"
    inMenu
    choices={LENS_CHOICES}
    chosen={(lens) => policy.lenses.includes(lens)}
    onpress={(lens) => change(withLens(policy, lens))}
  />
</div>

<DropdownMenu.Separator />
<DropdownMenu.Item icon={SlidersHorizontal} onSelect={onedit}>Edit list…</DropdownMenu.Item>
