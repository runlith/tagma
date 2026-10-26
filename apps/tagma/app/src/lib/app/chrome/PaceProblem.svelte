<script lang="ts">
  import Callout from '@runlith/chat-ui/Callout.svelte';
  import type { ClassValue } from 'svelte/elements';
  import { PACE_LABEL, Pace } from '$lib/features/power/Pace.svelte.js';

  let { class: className }: { class?: ClassValue } = $props();

  const pace = Pace.use();

  const shown = $derived.by(() => {
    if (pace.problem !== null) return { title: "Agents' share was not saved", note: pace.problem, saved: false };
    const standing = pace.standing;
    if (standing === null) return null;
    const level = PACE_LABEL[standing.pace];
    const state = standing.state;
    if (state._tag === 'unavailable') return { title: `${level} is not applied to agents' commands`, note: state.reason, saved: true };
    if (state._tag === 'applied' && state.failed > 0) {
      const whom = state.failed === 1 ? '1 running process' : `${state.failed} running processes`;
      return { title: `${whom} could not be moved to ${level}`, note: undefined, saved: true };
    }
    return null;
  });
</script>

{#if shown !== null}
  <Callout
    tone="error"
    title={shown.title}
    note={shown.note}
    onDismiss={shown.saved ? undefined : () => pace.dismiss()}
    class={className}
  />
{/if}
