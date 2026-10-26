<script lang="ts">
  import { REVIEW_LENSES, REVIEWERS_MAX, type ReviewPolicy, type ReviewSplit, type TeamModel } from '@runlith/agent/collaboration/team';
  import ModelRow from './ModelRow.svelte';
  import Segmented from './Segmented.svelte';
  import Stepper from './Stepper.svelte';
  import { pooled, poolRows, withLens, withPooled } from './edits.js';
  import { LENS_WORDS } from './words.js';

  let {
    policy,
    rows,
    disabled = false,
    onchange,
  }: { policy: ReviewPolicy; rows: readonly TeamModel[]; disabled?: boolean; onchange: (policy: ReviewPolicy) => void } = $props();

  const SPLITS: readonly { value: ReviewSplit; label: string }[] = [
    { value: 'same', label: 'Same' },
    { value: 'lenses', label: 'Lenses' },
  ];

  const offered = $derived([...poolRows(policy, rows), ...rows.filter((row) => !pooled(policy, row))]);
</script>

<div class="grid min-w-0" data-review-form>
  <div class="flex h-7 items-center gap-2 px-2 text-ui">
    <span class="flex-1">Reviewers</span>
    <Stepper
      label="Reviewers"
      value={policy.reviewers}
      minimum={0}
      maximum={REVIEWERS_MAX}
      {disabled}
      onchange={(reviewers) => onchange({ ...policy, reviewers })}
    />
  </div>
  {#each offered as row (`${row.provider}/${row.model}/${row.reasoning}`)}
    <ModelRow {row} checked={pooled(policy, row)} quota {disabled} onclick={() => onchange(withPooled(policy, row))} />
  {:else}
    <p class="px-2 py-1 text-small text-muted-foreground">No models are listed for sub-agents.</p>
  {/each}
  <div class="my-1 h-px bg-border"></div>
  <div class="flex h-7 items-center gap-2 px-2 text-ui">
    <span class="flex-1">Split</span>
    <Segmented label="Split" choices={SPLITS} value={policy.split} {disabled} onchange={(split) => onchange({ ...policy, split })} />
  </div>
  {#if policy.split === 'lenses'}
    <div class="flex flex-wrap gap-1 px-2 pt-0.5 pb-1.5">
      {#each REVIEW_LENSES as one (one)}
        <button
          type="button"
          class={[
            'rounded-full border px-2 py-0.5 text-meta font-medium transition-colors disabled:opacity-60',
            policy.lenses.includes(one) ? 'bg-selected text-foreground' : 'text-muted-foreground hover:text-foreground',
          ]}
          aria-pressed={policy.lenses.includes(one)}
          {disabled}
          onclick={() => onchange(withLens(policy, one))}
        >
          {LENS_WORDS[one]}
        </button>
      {/each}
    </div>
  {/if}
</div>
