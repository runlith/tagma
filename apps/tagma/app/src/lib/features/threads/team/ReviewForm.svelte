<script lang="ts">
  import { REVIEWERS_MAX, type ReviewPolicy } from '@runlith/agent/collaboration/team';
  import Chips from '$lib/shared/ui/Chips.svelte';
  import Stepper from './Stepper.svelte';
  import { withLens } from './edits.js';
  import { LENS_CHOICES } from './words.js';

  let {
    policy,
    marked,
    disabled = false,
    onchange,
  }: { policy: ReviewPolicy; marked: readonly string[]; disabled?: boolean; onchange: (policy: ReviewPolicy) => void } = $props();
</script>

<div class="grid" data-review-form>
  <div class="flex items-center gap-4 py-3">
    <div class="grid min-w-0 flex-1 gap-0.5">
      <span class="text-ui font-medium">Reviewers</span>
      <span class="text-small text-muted-foreground"
        >At most this many per delivery; the agent starts as many as the work needs. 0 means no review.</span
      >
    </div>
    <Stepper
      label="Reviewers"
      value={policy.reviewers}
      minimum={0}
      maximum={REVIEWERS_MAX}
      {disabled}
      onchange={(reviewers) => onchange({ ...policy, reviewers })}
    />
  </div>
  <div class="grid gap-0.5 border-t border-vein py-3">
    <span class="text-ui font-medium">Who reviews</span>
    <span class="text-small text-muted-foreground" data-review-marked>
      Picked for each delivery from the models checked under Review above, by the same ratings. Now: {marked.length === 0
        ? 'nobody is checked, so no review starts'
        : marked.join(', ')}.
    </span>
  </div>
  <div class="flex items-center gap-4 border-t border-vein py-3">
    <div class="grid min-w-0 flex-1 gap-0.5">
      <span class="text-ui font-medium">What they look at</span>
      <span class="text-small text-muted-foreground"
        >None chosen: each reviewer reads the whole work. Chosen: the first reads the whole, each next one a lens.</span
      >
    </div>
    <span class="max-w-80">
      <Chips
        label="What they look at"
        choices={LENS_CHOICES}
        chosen={(lens) => policy.lenses.includes(lens)}
        {disabled}
        onpress={(lens) => onchange(withLens(policy, lens))}
      />
    </span>
  </div>
</div>
