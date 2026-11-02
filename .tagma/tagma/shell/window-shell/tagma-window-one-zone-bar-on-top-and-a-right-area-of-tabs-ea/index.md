---
id: 01a15622-e2ef-7840-b59b-5e32e200e09f
title: "Tagma window: one zone bar on top and a right area of tabs each thread remembers"
ord: 13
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a118f1-5f59-7eb8-856a-a0e730b488ab
  - kind: relates
    to: 01a14c05-9e8f-7c75-a633-b2a70614903d
  - kind: relates
    to: 01a14c08-1c3f-7bde-a2e3-0462886d0b63
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03b603abb142
  - kind: relates
    to: 01a14c14-6895-75c6-80f2-47ad00ee51b6
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/ChatShell.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/Shell.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/TopBar.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/app/panes/SidePanes.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/browser/OpenPages.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/FilesColumn.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/OpenFile.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/ThreadMain.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/places/State.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/terminal/Panel.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/Header.svelte
---
**Result.** The Tagma window on desktop and web is shaped as:
- one bar on top instead of two;
- everything opening beside the main area is tabs of one right area;
- each thread owns its tab set, and in thread-less sections the section does.

A thread grows 32 px taller. Thread tools stand next to its name. You return to a thread with the same tabs you left.

The reference is the `one-row.html` mockup in the scratch of thread `01a125fe-9260-7644-9a64-589c9bc19e19` (the "Tagma One Row" artifact). The operator accepted it 2026-10-19 with the decisions: one bar, tabs instead of panels, memory at the thread, a thread is also a tab, no split. The spec-review (thread `01a15624-91c4-7afa-9459-56d1bddba817`) verified the spec against the code; its findings are accounted for below.

**What stands now.**
- **Shared bar.** `app/chrome/TopBar.svelte`, 36 px tall: set by the desktop `titleBarOverlay` strip ([[c4c7b819]]). It holds the traffic light, BackForward, project, branch, a wide "Find or ask… ⌘K" field (an icon in a narrow window), CaptureChip, attention, menu. The projects bar `tabs` mode adds a `TabRow` line above it.
- **Thread header.** `features/threads/Header.svelte`, a second `h-8` line. It holds:
  - the name with the thread menu (`Menu.svelte`);
  - the draft agent picker "as &lt;type&gt;" with rejected agent files and "New thread as…";
  - ‹ parent and ↖ detached-from crumbs, the born-as chip;
  - a deleted-account warning;
  - `ModeButton`, `TeamButton`, `WorktreeChip`, `TransportChip`.
  
  Tools are assembled by `app/chrome/ChatShell.svelte`: `PagesButton` (thread-artifact popover), `TerminalToggle`, `ChangesToggle`. The model is picked in composer, not in the header.
- **Changes.** A `FilesColumn` on the right: the change list, ↑/↓ open the neighboring file's diff. Whether the column is open is local `filesOpen` in `ChatShell`. In a narrow window this is an overlay with a scrim, Esc, and focus return.
- **File and diff.** `OpenFile` (thread tier) shown in `ThreadMain` as a seam beside the feed or over it.
- **Terminals.** `TerminalPanel` at the bottom; places (worktree) have their own tab bar and splits (`executions/places`).
- **Side panels.** `SidePanes`, `thread`, `browser`, `plugin` views. One layout per project, oldest panel evicted ([[a562a1a3]], [[0614903d]]). Drawn on every project section (`Shell.svelte`, `BesideSlot`).
- **Who is in focus.** `ThreadOnScreen` fills `SidePanes`. Composer focus, read marks, `OpenPages`, Picks, UsageMeters, worktree acts, and `FrameFollow`, which moves `?branch` to the focus thread's worktree, depend on it.

One "show beside" action is built five ways, and none but `OpenFile` remembers the thread.

**What will be.**

*Window bar* — 36 px, `chrome`. The height stays the `titleBarOverlay` bar height, desktop unchanged. Three zones by window column:
- **A — over the rail and section column.** Traffic light, ←→, project ⌄, branch ⌄ with an uncommitted mark. Zone width is rail plus column, stretches with the column. If the column is collapsed or the section has none, traffic light, ←→, project icon, and ⌘K search icon remain.
- **B — over the main area.** What is now in the thread header, in one line:
  - name ⌄ with a work indicator; the menu is today's `Menu.svelte` whole;
  - ‹ parent / ↖ detached-from crumbs;
  - chips, only when present: born-as, team, worktree, transport, mode (`ModeButton`), account warning;
  - at the draft, the "as &lt;type&gt;" agent picker;
  - tools on the right: Pages (popover, as now), terminal with the place's live-terminal counter, Changes with counter, browser, ⋯.
  
  A tool is a plain action: opens its view's tab or moves to the already open one. It has no pressed state and closes no tab: only tabs show what is open and selected. Pages gets no tab-view: it is a popover of external artifact links.
- **C — over the right area.** Tab bar, "+", "collapse area" (⌥⌘\; ⌘\ stays with the section column), then CaptureChip, attention, menu. If the right area is closed, these buttons move to the end of zone B.

The projects bar `tabs` mode keeps its `TabRow` line over the window: those are project tabs, not thread tabs.

*Search.* No wide field in the middle.
- The "Find or ask… ⌘K" field stands in the agents column header instead of Filter (`/`). Input filters the column as Filter does now. Enter and ⌘K open the palette with the entered text.
- Where there is no agents column or it is collapsed, the palette entry is the zone-A icon.

*Right area is tabs only.* A tab view is a declared view of today's registry (`PaneKind`, `declaredPanes.ts`) with its own min/base/max geometry. Views:

| View | Inside | Identity (`id`) |
|---|---|---|
| `thread` | thread feed and input; project label for another project's thread; "Open as main" | `projectId:threadId` |
| `changes` | the thread's change list **and** the selected file's diff in one tab, ↑/↓ over neighboring files, repeated click closes diff — as `FilesColumn` + seam now | `changes` |
| `file` | a file opened from the feed, a link, the palette, or "open file at this place" from diff | `projectId+rootId+path` and line; view and selection not stored. A file diff opens in the `changes` tab, there is no separate diff tab |
| `terminal` | the place's tab with its split tree | place tab key |
| `browser` | page | `project:page` |
| `plugin` | plugin view | `plugin/view` |

Each browser page is a separate right-area tab, level with files and terminals. A browser tab has no inner tab strip of its own: the panel `TabStrip` leaves, the tab keeps address bar, navigation, search, scale, DevTools, and downloads. Address-bar hints still offer the project's open and recently closed pages.

How a tab opens:
- the zone-B tool, "+" (File… ⌘P, Terminal, Changes, Browser page ⌘T, the project's open pages and terminals, recently closed terminals), ⌥-click on a thread in the column, ⌘I "ask" (a thread tab with staged context, as `panes.ask` now), the "New thread beside" palette action (formerly "Split right").
- Reopening the same thing (same `{kind, id}`) moves to its tab.
- Toggles close the tab on repeated press when active: zone-B tools.
- A feed link leads to the page in the layout's active browser tab, as `showPage` does now. ⌘-click opens the link in the system browser.
- A column click on a thread standing as a tab in the current layout activates that tab, as `reveal` does now.
- A thread never becomes a tab of itself.
- No per-place limits: unlimited tabs, the bar scrolls and never squeezes the main area. `SidePanes` eviction leaves.
- "Show in Files" moves to the Checkout page with the tree ([[47f441fe]]), not a tab.

*Where a tab lands.* A thing opened from a thread lands in the layout of the holder currently showing that thread on screen. If the thread is open as main — in its layout. If the thread is shown as a tab — in that screen's main thread layout. If the thread is off-screen — in its own layout.
- Opened by operator gesture, it activates.
- Opened by an agent (page, terminal), it lands in the background: a tab "driven by agent", focus never stolen.

*Layouts are one `TabLayouts` store.* It is a `project`-tier service: a layout is data, not thread life. Thread tier never holds it, because it never rises for drafts, off-screen threads, or sections.
- **Layout holder** is a thread (`threadId`), a draft (its `new:<projectId>` key), or a thread-less section (`section:<id>`).
- **Layout** is the tab set, order, active tab, area width, whether the area is open.
- **A draft birthing a thread** carries the draft layout to the born thread in the same step as navigation.
- **Stored on device** (`platform.storage.local`), one key per holder with a last-use mark. No shared index, so two desktop windows of projects never overwrite each other's layouts. One layout in two windows is won by the last write; the window re-reads it on `storage` events.
- **Cleanup.** At startup the store deletes keys older than 30 days and beyond 500 per project, oldest first. A layout is hundreds of bytes, so 500 hold under 1 MB of the ~5 MB `localStorage` budget per origin on any machine. A deleted or archived thread loses its layout lazily: on open and by age.
- **A vanished thing.** Each view's owner declares whether the thing still `stands(id)`: the thread not deleted, the page open, the place tab existing, the plugin contributing the view, the file existing. The layout filters on restore and on owner events. Today's plugin `retain` becomes a special case.

*Terminals.* The bottom `TerminalPanel` leaves. Its mechanisms go:

| Mechanism | Will be |
|---|---|
| place tab with splits | a `terminal` tab; splits, pane detach into a new tab — inside the tab (detach makes a new tab in the same layout) |
| new/reopen/rename/close-all/next/prev/recent/select-index keys | act on right-area tabs when focus is in a terminal tab; toggle-terminals opens/moves to a terminal tab |
| closed-tab stack and reopen | stays at the place; reopen from "+" and by key |
| close a tab | removes the tab from the layout; the process lives. Stopping is ✕ in the terminal panel with today's `CloseTerminalDialog` |
| agent-launched shell (`start_terminal`, holder is the thread) | lands in the background in the holder thread's layout per the "where a tab lands" rule |
| terminal with `launchedFor` (a harness-thread session) | not a tab: the thread's own main view, as now |
| `?terminal=` deep link | opens a tab in the main thread's layout |
| shell autostart on an empty place | "+ → Terminal" and the zone-B tool launch a shell if the place has no tabs |
| the place's live-terminal counter | on the terminal tool in zone B |
| "New terminal" palette | a new terminal tab |
| `terminal.placeLayouts` (order, active, shown, closed, splits, titles) | stays at the place as the place tabs' store; `shown` and `active` stop driving display — the tab layout decides display |

A place tab key after reload, when all its runs are over, is filtered by the vanished-thing rule. "+ → Terminal" starts in the layout main thread's place.

*Focus.* `ThreadOnScreen` fills the right-area container:
- `host` is the screen's main thread;
- focus is the main thread or the active thread tab, when input focus is in it (as panel focus now).

`FrameFollow` follows focus, as now.

*Sections.* The right area with tabs exists in every project section: chat, Checkout (outline and block page), Graph, Journal, Rules, Pages, plugin sections. The layout belongs to the thread in chat and to the section elsewhere. Zone B shows the name of what the section opens (block, commit, file) and the tools the section declares. Checkout keeps its tab area in the main area ([[47f441fe]]); on its right are thread tabs for ⌘I "ask about diff/commit" and review beside diff.

*Narrow window.* The right area becomes an overlay over the main area if `window width − rail − column − active view min < CONVERSATION_MIN`. The overlay carries its own tab bar, scrim, Esc, and focus return to the tool — a shared container, not `FilesColumn`.

*Width.* Area width lives in the layout and clamps to the active view's min/max when shown. `beside`, `browser`, `plugin`, `files`, `diff`, `terminals` size keys in `Panes` leave.

*Menu over the browser page.* On desktop the page is a native `WebContentsView` ([[761cf71f]]) and covers HTML menus. While a menu, popover, or overlay intersecting the right area is open ("+", bar overflow, title menu), the page's place shows its snapshot (`capturePage`) and the live view steps aside. This belongs to this spec: without it "+" does not work.

*Mobile shell* unchanged: it never depends on `SidePanes`, `OpenFile`, `TerminalPanel`, or `FilesColumn`. The plugin-view window (`MainWindowShell.openPane`) untouched.

**Device.**
- **Layouts owned by `TabLayouts`.** `SidePanes` becomes the right-area container: draws the current holder's layout, width, overlay, focus, `ThreadOnScreen`.
- **`ShellOps` keeps semantics ([[30b488ab]]).** `openThread(…, 'beside')` and `openPane(kind, id)` open tabs per the "where a tab lands" rule. One "slot → thread" writer stays.
- **`OpenFile` and `filesOpen` leave.** `FileOpener` opens a `file` tab, `ThreadChanges` a `changes` tab.
- **Each view's owner declares at home:** view, tab icon and label, identity, `stands`, the "driven by agent" flag, the zone-B tool contribution (icon, counter). The container never branches by view. A new view is a declaration in the feature.
- **The shell builds the bar.** Zone A itself. Zones B and C from holder and section contributions. Thread chips are feature contributions, as in [[b7bb8a8f]].

**Out of scope.**
- Splitting the right area into columns.
- Main-area Checkout tabs.
- Mobile shell.
- Changing the `titleBarOverlay` bar height.

**Fixed by the same change are blocks** that would turn false: [[47f441fe]] (`OpenFile` stage), [[a562a1a3]] and [[0614903d]] (eviction, project layout), [[f9c4cd67]] (`retain` in `SidePanes`), [[00ee51b6]] (bottom terminal panel), [[03abb142]] (Changes column).

**Acceptance.**
1. One 36 px bar over the work; `Header` as a bar gone. Every element of "What stands now" reachable in zone B or the title menu.
2. The ⌘K palette opens from the column field, the zone-A icon, and by key. Enter in the field opens it with the entered text. No wide field in the middle.
3. File, diff, Changes, terminal, page, thread, and plugin view open only as tabs. `TerminalPanel`, `FilesColumn`, and `SidePanes` eviction deleted.
4. `TabLayouts` and container tests:
   - two threads hold different layouts; return restores set, order, active tab, and width;
   - reopening moves to the existing tab;
   - a thread never becomes a tab of itself;
   - closing an agent page tab or terminal tab stops neither the process nor the page;
   - layout survives reload;
   - draft layout passes to the born thread;
   - a vanished thing filtered on restore;
   - cleanup deletes keys past age and limit;
   - writing one thread's layout never changes another's key.
5. The "where a tab lands" rule:
   - a page opened by a subagent agent, shown as a tab, lands in the background in the main thread's layout;
   - an agent shell lands in its holder thread's layout;
   - a `launchedFor` terminal never becomes a tab.
6. Another project's thread tab addresses home ([[78ba2951]]) and carries a project label.
7. In Checkout ⌘I opens a thread tab on the right; in Graph the right area holds the section layout.
8. In a narrow window the right area is an overlay with Esc and focus return; ⌥⌘\ collapses the area, ⌘\ the column.
9. Over the browser page the "+" menu shows whole (page snapshot while the menu is open).
10. Terminal keys from the table work on terminal tabs; reopen raises the place tab with splits.
11. A new tab view is added by a feature declaration with no container or shell edit (a test view).
12. App typecheck clean; files within [[6b3210c7]].

Operator eyes-on is no acceptance condition.
