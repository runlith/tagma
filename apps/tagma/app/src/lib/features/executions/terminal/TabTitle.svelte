<script lang="ts">
  import FadeText from '$lib/shared/FadeText.svelte';
  import type { SidePane } from '$lib/shared/panes/pane.js';
  import TerminalIcon from '../TerminalIcon.svelte';
  import { Terminals } from '../worktrees/Terminals.svelte.js';
  import TabFace from './TabFace.svelte';

  let { pane }: { pane: SidePane } = $props();

  const terminals = Terminals.use();
  const worktree = $derived(pane.id === null ? null : terminals.worktreeOf(pane.id));
  const tab = $derived(worktree === null || pane.id === null ? null : worktree.tabOf(pane.id));
</script>

{#if worktree !== null && tab !== null}
  <TabFace {worktree} {tab} />
{:else}
  <TerminalIcon class="size-3.5 shrink-0" />
  <FadeText class="font-mono" text="Terminal" />
{/if}
