<script lang="ts">
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import Columns2 from '@lucide/svelte/icons/columns-2';
  import PencilLine from '@lucide/svelte/icons/pencil-line';
  import Plus from '@lucide/svelte/icons/plus';
  import { Router } from '@runlith/layer/Router';
  import { Seam } from '@runlith/seam/Seam.svelte';
  import Reveal from './Reveal.svelte';
  import SeamHandle from '@runlith/seam/SeamHandle.svelte';
  import { Keymap } from '$lib/app/keys/Keymap.svelte.js';
  import TabRail from '$lib/shared/TabRail.svelte';
  import { Seams } from '$lib/shared/seams/Seams.svelte.js';
  import { Button } from '$lib/shared/ui/button/index.js';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import { TERMINALS_SEAM } from '../seams.js';
  import { Terminals } from '../worktrees/Terminals.svelte.js';
  import Body from './Body.svelte';
  import { closeFocused, routeKey } from './keys.js';
  import { TerminalKeymap } from './Keymap.js';
  import type { TerminalTab } from './Tab.svelte.js';
  import TabFace from './TabFace.svelte';

  const terminals = Terminals.use();
  const router = Router.use();
  const keymap = TerminalKeymap.use();
  const appKeys = Keymap.use();
  const seams = Seams.use();
  const seam = new Seam(seams.seam(TERMINALS_SEAM), { onCommit: (size) => seams.set(TERMINALS_SEAM, size) });

  const worktree = $derived(terminals.home);
  let panel: HTMLElement | null = $state(null);
  const newLabel = $derived(keymap.chordLabel('new-tab'));
  const splitLabel = $derived(keymap.chordLabel('split-right'));
  const foldLabel = $derived(keymap.chordLabel('toggle-terminals'));

  $effect(() => terminals.mountPanel());

  const revealed = $derived(router.url.searchParams.get('terminal'));

  function onPanelKey(event: KeyboardEvent): void {
    if (worktree !== null) routeKey(event, keymap, worktree.current, (act) => terminals.perform(act, worktree, null));
  }

  $effect(() =>
    appKeys.bind(
      keymap.chords('toggle-terminals').map((chord) => ({
        chord,
        run: (page) => {
          if (page === null && document.activeElement?.closest('.xterm') != null) return false;
          terminals.toggle();
          return true;
        },
      })),
    ),
  );

  $effect(() =>
    appKeys.bind(keymap.chords('close-pane').map((chord) => ({ chord, run: () => closeFocused(panel, worktree?.current ?? null) }))),
  );

  function split(): void {
    const tab = worktree?.current ?? null;
    const pane = tab?.current ?? null;
    if (tab !== null && pane !== null) tab.perform({ _tag: 'split-right' }, pane);
  }
</script>

{#if revealed !== null}
  {#key revealed}<Reveal address={revealed} />{/key}
{/if}

{#snippet face(tab: TerminalTab)}
  {#if worktree !== null}<TabFace {worktree} {tab} />{/if}
{/snippet}

{#snippet extra(tab: TerminalTab)}
  <DropdownMenu.Item icon={PencilLine} onSelect={() => worktree?.beginRename(tab.key)}>Rename</DropdownMenu.Item>
{/snippet}

{#snippet add()}
  <Tooltip text="New terminal" keys={newLabel}>
    <Button
      variant="quiet"
      size="icon-xs"
      class="self-center"
      aria-label="New terminal"
      disabled={worktree === null || worktree.opening || worktree.folder === null}
      onclick={() => worktree !== null && void terminals.openPanel(worktree)}
    >
      <Plus class="size-3.5" />
    </Button>
  </Tooltip>
{/snippet}

{#snippet tools()}
  <Tooltip text="Split" keys={splitLabel}>
    <Button
      variant="quiet"
      size="icon-xs"
      class="self-center"
      aria-label="Split"
      disabled={worktree?.current?.current == null}
      onclick={split}
    >
      <Columns2 class="size-3.5" />
    </Button>
  </Tooltip>
  <Tooltip text="Hide terminals" keys={foldLabel}>
    <Button variant="quiet" size="icon-xs" class="mr-1 self-center" aria-label="Hide terminals" onclick={() => terminals.hide()}>
      <ChevronDown class="size-3.5" />
    </Button>
  </Tooltip>
{/snippet}

{#if terminals.shown}
  <SeamHandle {seam} label="Resize the terminals" />
{/if}
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section
  bind:this={panel}
  class={['flex min-h-0 min-w-0 shrink-0 flex-col overflow-clip border-t bg-background', !terminals.shown && 'hidden']}
  style:height="{seam.size}px"
  aria-label="Terminals"
  onkeydown={onPanelKey}
  data-terminal-panel={worktree?.rootId ?? ''}
>
  <header class="flex h-8 shrink-0 border-b bg-chrome">
    {#if worktree !== null}
      <TabRail
        class="h-full flex-1 pl-1"
        items={worktree.panel}
        key={(tab) => tab.key}
        active={worktree.active}
        label="Terminals"
        name={(tab) => worktree?.titleOf(tab) || 'Terminal'}
        activate={(id) => worktree?.select(id)}
        close={(id) => worktree?.requestClose(id)}
        move={(id, before) => worktree?.move(id, before)}
        tab={face}
        acts={extra}
        after={add}
        end={tools}
      />
    {/if}
  </header>
  <Body {worktree} tabs={worktree?.panel ?? []} active={worktree?.active ?? null} />
</section>
