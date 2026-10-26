<script lang="ts">
  import { HiddenStates } from '$lib/features/graph/HiddenStates.svelte.js';
  import { RESTING_LABEL, RESTING_STATES, type RestingState } from '$lib/features/graph/status.js';
  import Group from '$lib/features/settings/Group.svelte';
  import type { SectionProps } from '$lib/features/settings/section.js';

  let {}: SectionProps = $props();

  const hidden = HiddenStates.use();

  const RESTING_HINT: Record<RestingState, string> = {
    done: 'the work happened',
    closed: 'decided against',
    superseded: 'a successor took its place',
    answered: 'a reflection something answered',
  };
</script>

<Group title="Resting blocks">
  {#each RESTING_STATES as state, index (state)}
    <label class="flex cursor-pointer items-center gap-3 border-vein py-3 text-ui" class:border-t={index > 0}>
      <input
        type="checkbox"
        class="size-4 shrink-0 accent-primary"
        checked={hidden.isHidden(state)}
        onchange={() => hidden.toggleHidden(state)}
      />
      <span class="min-w-0 flex-1">Hide <span class="font-medium">{RESTING_LABEL[state]}</span></span>
      <span class="shrink-0 text-small text-muted-foreground">{RESTING_HINT[state]}</span>
    </label>
  {/each}
</Group>
