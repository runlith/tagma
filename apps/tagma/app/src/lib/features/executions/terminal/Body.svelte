<script lang="ts">
  import { Host } from '@runlith/layer/Host';
  import { TerminalAppearance } from '../appearance/Settings.svelte.js';
  import { Terminals } from '../worktrees/Terminals.svelte.js';
  import type { WorktreeTerminals } from '../worktrees/WorktreeTerminals.svelte.js';
  import Dictated from './Dictated.svelte';
  import { TerminalKeymap } from './Keymap.js';
  import type { TerminalPane } from './Pane.svelte.js';
  import TerminalPaneTree from './PaneTree.svelte';
  import type { TerminalTab } from './Tab.svelte.js';
  import TerminalToast from './Toast.svelte';

  let { worktree, tabs, active }: { worktree: WorktreeTerminals | null; tabs: readonly TerminalTab[]; active: string | null } = $props();

  const terminals = Terminals.use();
  const keymap = TerminalKeymap.use();
  const appearance = TerminalAppearance.use();
  const isMac = Host.use().apple;

  const MESSAGE = 'grid h-full place-content-center px-6 text-center text-ui text-muted-foreground';
</script>

{#snippet dictation(pane: TerminalPane, element: HTMLElement)}
  <Dictated {pane} {element} />
{/snippet}

{#if terminals.floorNotice !== null}
  <TerminalToast message={terminals.floorNotice} placement="floor" onDismiss={() => terminals.dismissFloorNotice()} />
{/if}
<div class="relative min-h-0 flex-1">
  {#if worktree !== null}
    {#each tabs as tab (tab.key)}
      <div class={['absolute inset-0', active !== tab.key && 'hidden']} data-terminal-tab-id={tab.key}>
        <TerminalPaneTree {tab} {keymap} {appearance} {isMac} {dictation} detach={(id) => void terminals.detach(worktree, tab.key, id)} />
      </div>
    {/each}
  {/if}
  {#if tabs.length === 0}
    {#if terminals.inventory._tag === 'failed'}
      <p class={MESSAGE} data-panel-state="failed">Reconnecting to this project's terminals…</p>
    {:else if terminals.inventory._tag === 'reading'}
      <p class={MESSAGE} data-panel-state="reading">Reading this project's terminals…</p>
    {:else if worktree === null}
      <p class={MESSAGE} data-panel-state="nowhere">This address stands in no worktree, so there is no place to open a terminal in.</p>
    {/if}
  {/if}
</div>
