---
id: 01a13d48-9aa9-71d0-a2d8-68fb74b99a0a
title: "Own UI components instead of external libraries: Tagma does not depend on bits-ui, ark, mode-watcher or shadcn leftovers"
ord: 4
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a0c83d-a829-7d4b-bfbb-6824de36c9fd
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/shared/ui
  - kind: dir
    ref: packages/primitives
---
Tagma's interface does not depend on any external library of classic UI components. The behaviour of everything that rises above the page belongs to the `@runlith/primitives` kit ([[de36c9fd|overlays module]]): menu, popover, select, command list, tooltip, dialog. Notifications, theme, and classes belong to the app. Look belongs to the app wrappers in `apps/tagma/app/src/lib/shared/ui`.

**What the operator gets.**
- A popup is visible above what opened it, including inside a dialog from `DialogHost`.
- Escape closes exactly the top layer.
- A click outside closes what was clicked outside of, and nothing below.
- An error is visible even with the palette open.
- Notifications are a single column.
- The theme does not flash on startup.

**Why.** Today there are two owners of "what is on top" above the page and two closing systems.
- **Depth.** The dialog from the host stands at z ≥ 1510 per the `OverlayLayers` ticket (`DialogHost.svelte:49`). Menu, popover, tooltip, inline-dialog content, `NoticeCards`, and `RestartNotice` stand on template `z-50`: `shared/ui/dropdown-menu/dropdown-menu-content.svelte:26`, `popover-content.svelte:26`, `tooltip-content.svelte:30`, `dialog-content.svelte:29`, `app/chrome/NoticeCards.svelte:15`, `app/chrome/RestartNotice.svelte:54`. bits copies the computed z onto its own wrapper. So under the agent-library window, the code places its `Hint` (`threads/library/AgentPrompt.svelte:69`, `AgentDefinitionEditor.svelte:231`) and the inline "Discard this draft?" dialog (`AgentLibrary.svelte:402-419`). This is concluded from code, not reproduced in the browser. Only select is connected to the scale (`select-content.svelte:24`).
- **Closing.** bits has its own Escape stack on document. The dialog guesses that Escape was already consumed by a nested layer: it looks at `aria-expanded`/`data-state="open"` on the target, at `defaultPrevented`, and defers the decision via `setTimeout` (`packages/primitives/src/dialog/content.svelte:39-48, 85-103, 157-186`).
- **Scroll-lock.** Two mechanisms independently remove and restore body styles: `dialog/scroll-lock.ts` and bits' body-scroll-lock on select.

**In scope.**
- bits-ui 2.19.5: DropdownMenu, Popover, Select, Command, Tooltip, Separator, `useId`. These are the `shared/ui/{dropdown-menu,popover,select,command,tooltip,separator}` wrappers and three direct imports: `app/chrome/AppMenu.svelte`, `features/providers/Menu.svelte`, `features/providers/usage/Popover.svelte`.
- `@ark-ui/svelte` (`packages/primitives/src/toast/Toaster.ts`).
- `mode-watcher`, `tailwind-variants`, `tw-animate-css`.
- `shadcn-svelte` — both the CLI and `@import 'shadcn-svelte/tailwind.css'` in `app.css:3`, which brings the `data-open:` custom variants and others and the `no-scrollbar` utility.
- The `lucide-svelte` entry in the root catalog and the dead `@runlith/utils/class`.

**Out of scope.**
- `@lucide/svelte` — icons without behaviour.
- Engines: xterm, CodeMirror, Tiptap/ProseMirror, TanStack, marked.
- `clsx` + `tailwind-merge`. This is class merging with a token config, not a component; a single `cn` in the app remains — [[826b7939]].
- Composer panels in `packages/chat-ui` (`Composer.svelte:446,455`, `ComposerMenuPopup.svelte:37`). This is own code in the page flow, not a dependency — [[e8193bf0]].
- Other fixed surfaces with their own z: `features/plugins/windows/PanelLayer.svelte`, `app/mobile/Sheet.svelte`, `features/threads/ShelfLayer.svelte`, `chat-ui/ChatContextUsagePill.svelte`, the reset overlay in `terminal/PaneTree.svelte`. No depth defect there; don't touch them.
- `meta theme-color` in `app.html:9-10` follows the system, not the theme choice.
- Screen-reader check: the performer has no means. Roles and keyboard are set in each component.
- Phone check: the operator does it.

**Shared decisions.**
- **The kit is state, not components.**
  - Kit behaviour is state classes `.svelte.ts` and attachments: `{@attach menu.trigger}`, `{@attach item.attach}`.
  - Composite components (`Menu.Root`, `Menu.Item`, …) exist only in the app, in `shared/ui/<component>/`, where the namespace barrel `index.ts` is already allowed by rule 8183e6ef. No new barrels in the kit.
  - `dialog/` stays composite as it is.
- **The kit carries no classes.** It sets its own structure with inline styles: position, z, `pointer-events`. Host classes (`DialogHost` today carries `bg-scrim`) come from the app. The kit's `@source` in `app.css:19` goes away.
- **One owner per mechanism.** Layer stack (depth and closing), placement, focus — [[313c7343]]; collection navigation — [[91d530fd]]. A component does not compute them itself.
- **Only what is used is built.** Parts and props are derived from call sites.
  - A name stays where the meaning is the same: `Root`, `Trigger`, `Content`, `Item`, `onSelect`, `closeOnSelect`, `side`, `align`, `sideOffset`, `collisionPadding`, `open`/`onOpenChange`/`bind:open`, `disabled`.
  - Where the meaning differs, the new name arrives at every call site in the same change: `anchor` instead of `customAnchor`, `returnFocus` instead of `onCloseAutoFocus`, `initialFocus` instead of `onOpenAutoFocus`.
- **Svelte event order.** Kit listeners hang on elements via attachments and fire before the consumer's delegated `on*` handlers. A listener on an ancestor fires before a descendant's handler. Therefore:
  - the kit never calls `stopPropagation`;
  - collection keys are handled only when the target is its field or item;
  - the consumer influences behaviour via props and callbacks.
- **Style hooks.** `data-state="open|closed"` is kept (27 files read it on triggers), `data-highlighted`, `data-disabled`, `data-side`, `data-align`, `aria-selected`/`data-selected`, plus the `menu`, `menuitem`, `listbox`, `option`, `dialog` roles. Item highlight is painted via `data-highlighted:`, not `focus:` — otherwise the token check does not see it (`checks/law/ui-tokens/states.ts:4`).
- **jsdom.**
  - No product path relies on APIs missing from jsdom: `showPopover` and the top layer.
  - App tests that drive menus (`checkout/CheckoutPage.svelte.test.ts:347-354`, `providers/Group.svelte.test.ts:104-111`) stay green without changing their contract.
- **Files ≤ 650 lines** (rule 6b3210c7). Mechanisms are split across files upfront: stack, focus, placement, tracking, submenu intent, collection, typeahead.
- **Animations** — Svelte transitions, unconditional (rule 77135f8f).

**Build.** All work goes in one `own-ui` worktree and merges into main with a single merge. So a kit stack and bits dismiss layers never live together on main: a nested layer of one system cannot see the other's Escape, and the wrong one closes.
1. [[72053c34]], then [[826b7939]] without shadcn css and `tw-animate-css` (`SnackBarHost` imports `primitives/cn.ts`); [[612a8cec]] — at any time.
2. [[313c7343]] → [[91d530fd]] → [[8e55c839]] → [[1bd06392]] → [[7e9ccf82]] → [[44500eab]] → [[92e227b7]].
3. The final step removes bits-ui, the shadcn css import (own variants instead), and `tw-animate-css`, and rewrites the body of the [[de36c9fd|overlays module card]]: the kit owns the layer stack, not a single dialog.

**Coverage.**
- Depth, closing, placement and tracking, portal, presence, focus, scroll-lock, Electron drag region — [[313c7343]].
- Navigation and typeahead — [[91d530fd]].
- Components — each in its own child.
- Notifications — [[72053c34]].
- Theme — [[612a8cec]].
- Classes, variants, shadcn css, dependencies, rule 8183e6ef text — [[826b7939]].

**Acceptance of the whole work.**
- Performer:
  - contract tests from the children;
  - `bun check`;
  - `node scripts/checkMotion.mjs`;
  - law checks at `submit_work`;
  - empty `rg` for `bits-ui|@ark-ui|mode-watcher|tailwind-variants|tw-animate|shadcn-svelte|--bits-|customAnchor|onCloseAutoFocus|onOpenAutoFocus` in `apps` and `packages` (without `archive`), for `focus:bg-selected` in `shared/ui`, and for `z-50`/`z-[` on layer surfaces;
  - lockfile written with `bun install`;
  - a run on its own instance (`tagma:try`) with frames: Tooltip and select inside the agent library; "Discard this draft?" above it; the usage-menu submenu; the context menu at the cursor in the file tree and in the terminal; an error above the palette; a menu overlapping the topbar.
- Operator (not a completion condition): look and animations in their own app, keyboard, phone.
