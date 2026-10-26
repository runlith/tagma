<script lang="ts">
  import { untrack } from 'svelte';
  import { Keymap } from '$lib/app/keys/Keymap.svelte.js';
  import type { SidePane } from '$lib/shared/panes/pane.js';
  import { Terminals } from '../worktrees/Terminals.svelte.js';
  import Body from './Body.svelte';
  import { closeFocused, routeKey } from './keys.js';
  import { TerminalKeymap } from './Keymap.js';

  let { pane }: { pane: SidePane; close: () => void } = $props();

  const terminals = Terminals.use();
  const keymap = TerminalKeymap.use();
  const appKeys = Keymap.use();
  let section: HTMLElement | null = $state(null);

  const worktree = $derived(pane.id === null ? null : terminals.worktreeOf(pane.id));
  const tab = $derived(worktree === null || pane.id === null ? null : worktree.tabOf(pane.id));

  $effect(() => {
    const shown = worktree;
    const key = tab?.key;
    if (shown !== null && key !== undefined) untrack(() => terminals.front(shown, key));
  });

  function onKey(event: KeyboardEvent): void {
    if (worktree !== null && tab !== null) routeKey(event, keymap, tab, (act) => terminals.perform(act, worktree, tab.key));
  }

  $effect(() => appKeys.bind(keymap.chords('close-pane').map((chord) => ({ chord, run: () => closeFocused(section, tab) }))));
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section bind:this={section} class="flex h-full min-h-0 min-w-0 flex-col bg-background" aria-label="Terminal" onkeydown={onKey}>
  <Body {worktree} tabs={tab === null ? [] : [tab]} active={tab?.key ?? null} />
</section>
