<script lang="ts">
  import { untrack } from 'svelte';
  import { terminalPaneOf } from '../kind.js';
  import { holdTerminal } from './owner.js';
  import { Keymap } from '$lib/app/keys/Keymap.svelte.js';
  import type { SidePane } from '$lib/shared/panes/pane.js';
  import Body from './Body.svelte';
  import { closeFocused, routeKey } from './keys.js';
  import { TerminalKeymap } from './Keymap.js';

  let { pane }: { pane: SidePane; close: () => void } = $props();

  const terminals = holdTerminal(untrack(() => pane.id));
  const keymap = TerminalKeymap.use();
  const appKeys = Keymap.use();
  let section: HTMLElement | null = $state(null);

  const address = $derived(terminalPaneOf(pane.id, terminals.projectId));
  const worktree = $derived(address === null ? null : terminals.worktreeOf(address.key));
  const tab = $derived(worktree === null || address === null ? null : worktree.tabOf(address.key));

  $effect(() => {
    const shown = worktree;
    const key = tab?.key;
    if (shown !== null && key !== undefined) untrack(() => terminals.front(shown, key));
  });

  function onKey(event: KeyboardEvent): void {
    if (worktree !== null && tab !== null) routeKey(event, keymap, tab, (act) => terminals.perform(act, worktree, tab.key));
  }

  $effect(() => appKeys.handle('tab.close', () => closeFocused(section, tab)));
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section bind:this={section} class="flex h-full min-h-0 min-w-0 flex-col bg-background" aria-label="Terminal" onkeydown={onKey}>
  <Body {worktree} tabs={tab === null ? [] : [tab]} active={tab?.key ?? null} />
</section>
