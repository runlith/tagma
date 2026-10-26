<script lang="ts">
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import TerminalIcon from '../TerminalIcon.svelte';
  import { Terminals } from '../worktrees/Terminals.svelte.js';
  import { TerminalKeymap } from './Keymap.js';

  const terminals = Terminals.use();
  const keymap = TerminalKeymap.use();

  const count = $derived(terminals.count(terminals.home));
  const chord = $derived(keymap.chordLabel('toggle-terminals'));
  const label = $derived(terminals.shown ? 'Hide terminals' : 'Show terminals');
</script>

<Tooltip text={label} keys={chord} side="top">
  <button
    type="button"
    class="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 tabular-nums transition-colors hover:bg-hover hover:text-foreground aria-pressed:bg-selected aria-pressed:text-foreground"
    aria-label={count > 0 ? `${label}, ${count} running` : label}
    aria-pressed={terminals.shown}
    onclick={() => terminals.toggle()}
    data-terminal-toggle={count}
  >
    <TerminalIcon class="size-3.5" />
    {#if count > 0}<span>{count}</span>{/if}
  </button>
</Tooltip>
