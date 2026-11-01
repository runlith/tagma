<script lang="ts">
  import FadeText from '$lib/shared/FadeText.svelte';
  import { untrack } from 'svelte';
  import { terminalPaneOf } from '../kind.js';
  import { holdTerminal } from './owner.js';
  import type { SidePane } from '$lib/shared/panes/pane.js';
  import TerminalIcon from '../TerminalIcon.svelte';
  import TabFace from './TabFace.svelte';

  let { pane }: { pane: SidePane } = $props();

  const terminals = holdTerminal(untrack(() => pane.id));
  const address = $derived(terminalPaneOf(pane.id, terminals.projectId));
  const worktree = $derived(address === null ? null : terminals.worktreeOf(address.key));
  const tab = $derived(worktree === null || address === null ? null : worktree.tabOf(address.key));
</script>

{#if worktree !== null && tab !== null}
  <TabFace {worktree} {tab} />
{:else}
  <TerminalIcon class="size-3.5 shrink-0" />
  <FadeText class="font-mono" text="Terminal" />
{/if}
