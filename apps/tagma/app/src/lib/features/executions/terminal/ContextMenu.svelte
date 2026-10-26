<script lang="ts">
  import Clipboard from '@lucide/svelte/icons/clipboard';
  import Copy from '@lucide/svelte/icons/copy';
  import Eraser from '@lucide/svelte/icons/eraser';
  import Hand from '@lucide/svelte/icons/hand';
  import Maximize2 from '@lucide/svelte/icons/maximize-2';
  import Minimize2 from '@lucide/svelte/icons/minimize-2';
  import PanelBottomClose from '@lucide/svelte/icons/panel-bottom-close';
  import PanelRightClose from '@lucide/svelte/icons/panel-right-close';
  import PanelsTopLeft from '@lucide/svelte/icons/panels-top-left';
  import Pencil from '@lucide/svelte/icons/pencil';
  import SquareArrowOutUpRight from '@lucide/svelte/icons/square-arrow-out-up-right';
  import TextSelect from '@lucide/svelte/icons/text-select';
  import X from '@lucide/svelte/icons/x';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';
  import type { TerminalKeymap } from './Keymap.js';
  import type { TerminalPane } from './Pane.svelte.js';
  import type { TerminalTab } from './Tab.svelte.js';

  let { tab, keymap, detach }: { tab: TerminalTab; keymap: TerminalKeymap; detach?: (pane: string) => void } = $props();

  const menu = $derived(tab.menu);
  const pane = $derived(menu === null ? null : (tab.panes.get(menu.pane) ?? null));
  const many = $derived(tab.count > 1);
  const expanded = $derived(menu !== null && tab.expanded === menu.pane);

  function run(act: (pane: TerminalPane) => void): void {
    const engine = pane;
    tab.closeMenu();
    if (engine === null) return;
    engine.focus();
    act(engine);
  }

  function onOpenChange(next: boolean): void {
    if (next) return;
    const engine = pane;
    tab.closeMenu(false);
    if (tab.menu === null) engine?.focus();
  }
</script>

{#if pane !== null}
  <DropdownMenu.Root bind:open={() => menu !== null, onOpenChange}>
    <DropdownMenu.Content
      anchor={menu === null ? undefined : { x: menu.x, y: menu.y }}
      class="w-60"
      align="start"
      sideOffset={0}
      data-pane-menu
      returnFocus={false}
      dismissOnFocusOutside={false}
    >
      <DropdownMenu.Item
        data-menu-split-right
        icon={PanelRightClose}
        keys={keymap.chordLabel('split-right')}
        onSelect={() => run((pane) => void tab.split(pane, 'row'))}
      >
        Split Terminal Right
      </DropdownMenu.Item>
      <DropdownMenu.Item
        data-menu-split-down
        icon={PanelBottomClose}
        keys={keymap.chordLabel('split-down')}
        onSelect={() => run((pane) => void tab.split(pane, 'column'))}
      >
        Split Terminal Down
      </DropdownMenu.Item>
      {#if many && detach !== undefined}
        <DropdownMenu.Item data-menu-detach icon={SquareArrowOutUpRight} onSelect={() => run((pane) => detach(pane.id))}>
          Move Pane to New Tab
        </DropdownMenu.Item>
      {/if}
      <DropdownMenu.Item
        data-menu-set-title
        icon={Pencil}
        keys={keymap.chordLabel('set-title')}
        onSelect={() => run((pane) => (tab.renaming = pane.id))}
      >
        Set Title…
      </DropdownMenu.Item>
      {#if pane.label !== null}
        <DropdownMenu.Item
          data-menu-clear-title
          icon={X}
          keys={keymap.chordLabel('clear-title')}
          onSelect={() => run((pane) => tab.retitle(pane.id, null))}
        >
          Clear Pane Title
        </DropdownMenu.Item>
      {/if}
      {#if pane.holder !== null && pane.ending === null}
        <DropdownMenu.Item data-menu-take-over icon={Hand} disabled={pane.takingOver} onSelect={() => run((pane) => void pane.takeOver())}>
          Take Over from {pane.holder.label}
        </DropdownMenu.Item>
      {/if}
      <DropdownMenu.Item data-menu-clear icon={Eraser} keys={keymap.chordLabel('clear')} onSelect={() => run((pane) => pane.clear())}>
        Clear Screen
      </DropdownMenu.Item>

      <DropdownMenu.Separator />

      <DropdownMenu.Item
        data-menu-equalise
        icon={PanelsTopLeft}
        keys={keymap.chordLabel('equalize')}
        disabled={!many || tab.expanded !== null}
        onSelect={() => run(() => tab.equalise())}
      >
        Equalize Pane Sizes
      </DropdownMenu.Item>
      <DropdownMenu.Item
        data-menu-expand
        icon={expanded ? Minimize2 : Maximize2}
        keys={keymap.chordLabel('expand-pane')}
        disabled={!many}
        onSelect={() => run((pane) => tab.expand(pane.id))}
      >
        {expanded ? 'Collapse Pane' : 'Expand Pane'}
      </DropdownMenu.Item>

      <DropdownMenu.Separator />

      <DropdownMenu.Item data-menu-copy icon={Copy} keys={keymap.chordLabel('copy')} onSelect={() => run((pane) => void pane.copy())}>
        Copy
      </DropdownMenu.Item>
      <DropdownMenu.Item
        data-menu-paste
        icon={Clipboard}
        keys={keymap.chordLabel('paste')}
        onSelect={() => run((pane) => void pane.paste())}
      >
        Paste
      </DropdownMenu.Item>
      <DropdownMenu.Item
        data-menu-select-all
        icon={TextSelect}
        keys={keymap.chordLabel('select-all')}
        onSelect={() => run((pane) => pane.selectAll())}
      >
        Select All
      </DropdownMenu.Item>
      <DropdownMenu.Item
        data-menu-copy-id
        icon={Copy}
        onSelect={() => run((pane) => void navigator.clipboard.writeText(pane.id).catch(() => undefined))}
      >
        Copy Pane ID
      </DropdownMenu.Item>

      <DropdownMenu.Separator />

      <DropdownMenu.Item
        data-menu-close
        variant="destructive"
        icon={X}
        keys={keymap.chordLabel('close-pane')}
        onSelect={() => run((pane) => tab.close(pane.id))}
      >
        Close Pane
      </DropdownMenu.Item>
    </DropdownMenu.Content>
  </DropdownMenu.Root>
{/if}
