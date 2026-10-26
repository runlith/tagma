<script lang="ts">
  import { AGENT_PACES } from '@tagma/server/power/contract/wire/power';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import { PACE_LABEL, Pace } from '$lib/features/power/Pace.svelte.js';

  const pace = Pace.use();

  const standing = $derived(pace.standing);
  const state = $derived(standing?.state ?? null);
  const shown = $derived(pace.choosing ?? standing?.pace ?? null);

  const note = $derived.by(() => {
    const whose = "Your own terminals, Tagma's own work around a command and the server always run at full speed.";
    if (standing === null || state === null) return `How much of this machine agents' commands may take. ${whose}`;
    const set = `Agents' commands: ${PACE_LABEL[standing.pace].toLowerCase()}.`;
    if (state._tag === 'handing') return `${set} Handing it to the execution host… ${whose}`;
    if (state._tag === 'unavailable') return `${set} Not applied: ${state.reason} ${whose}`;
    const kept = state.kept > 0 ? ` ${state.kept} running processes cannot be moved to it and stay at another level until they end.` : '';
    const lost = state.failed > 0 ? ` ${state.failed} processes could not be moved.` : '';
    return `${set} Applied to ${state.reached} running processes.${kept}${lost} ${whose}`;
  });
</script>

<span class="flex items-center gap-1.5" data-pace={standing?.pace} data-pace-state={state?._tag}>
  <Tooltip text={note}>
    <span class="text-meta text-muted-foreground">Agents' share</span>
  </Tooltip>
  <span class="inline-flex overflow-hidden rounded-md border border-border" role="radiogroup" aria-label="Agents' share of this machine">
    {#each AGENT_PACES as option (option)}
      <button
        type="button"
        role="radio"
        aria-checked={shown === option}
        disabled={standing === null || pace.choosing !== null}
        class={[
          'px-2 py-0.5 text-small disabled:opacity-60',
          shown === option ? 'bg-selected text-foreground' : 'text-muted-foreground hover:bg-hover',
        ]}
        onclick={() => void pace.choose(option)}>{PACE_LABEL[option]}</button
      >
    {/each}
  </span>
</span>
