---
id: 01a1741f-a3b7-7fc0-bf9a-6e37d7bc5513
title: "Any link opens by one rule: click — beside in the right area, Cmd-click — at the full place, right click — a menu of all places"
ord: 29
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-692dbb2a8aea
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-694b05354451
  - kind: relates
    to: 01a14c05-9e8f-7c75-a633-b2a70614903d
  - kind: relates
    to: 01a14c08-1c3f-7bde-a2e3-046371947f5b
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03c767192d2e
  - kind: relates
    to: 01a14c14-6895-75c6-80f2-47af5283a9d6
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/features/opening
  - kind: file
    ref: apps/tagma/app/src/lib/features/browser/Links.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/terminal/links.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/BlockTitles.svelte.ts
---
**Outcome.** Any link in the Tagma window opens by one rule, wherever it stands: in the thread feed, in a block body, in Changes, in a commit card, in the terminal. The rule is the same for a file, a graph block, a commit, a thread and a site.

- **Click** opens the thing beside: as a tab in the right area of the holder now on screen (thread, its draft or section without a thread). The reader does not leave their place. Repeating the click on the same thing moves to its tab instead of opening a second one.
- **Cmd-click** (Ctrl outside macOS) leads to the full place — the section where the thing is worked with deeply. For a site the full place is the system browser: on desktop the built-in browser has no section, it lives only in the right area.
- **Right click** opens the menu of all places of this link. The first two items repeat click and Cmd-click, with their shortcut written beside: the menu teaches the modifier. Then come outer places, copying at the end.
- **Hover** shows a tooltip with the normal tooltip delay: what will open and "⌘-click — Open in …".
- **Tab header** of the right area carries "Open in …" — the same full place as Cmd-click.
- **Keyboard:** Enter on a link is a click, Cmd+Enter is a Cmd-click.

| Link | Click — beside | Cmd-click — full place | Menu, besides the first two items |
|---|---|---|---|
| File | file tab | Files section at this file and row | Open in VS Code / Cursor / …, Reveal in Finder, Copy path, Copy path:line |
| Block | block tab (new view) | Knowledge section, block page | Copy name, Copy link |
| Commit | commit tab (new view): its files and diff | Git section, this commit | Copy SHA |
| Thread | thread as a tab on the right | thread in place of the current one | Copy link |
| Site | built-in browser page | system browser | Open in new browser tab, Copy link |

A file in a feed commit card stays a special case of a file: click opens this file's diff in the thread's Changes (whose rows are visible there), Cmd-click — the commit in the Git section.

**Why.** Reading the app code on 2026-10-25 found each link kind its own behaviour:
- a file in the feed opens on the right (`FileOpener` with `thread`), while Cmd-click carries it to an outer editor (`Conversation.svelte`, `openOutside`);
- a block link always moves to the Knowledge section (`BlockTitles.open` → `router.goto`): there is no block-tab view in the right area;
- a thread link from an answer text makes a full move (`threadHref`), while from feed cards it opens the thread on the right (`openThread(…, 'beside')`);
- a commit hash in text carries to the Git section, while a file in a commit card opens a diff on the right;
- in the Knowledge section paths in a block body are not clickable (`MarkdownBody` without `onOpenPath`), and Sources on a block page are plain text;
- in the terminal a click on a file opens it on the right, Cmd-click — in Files (`fileOpening` in `terminal/links.ts`), while a site does not open on a plain click at all;
- a right-click menu exists only at file paths in the feed (`PathMenu`), a hover tooltip only at a thread row and in the terminal (`LinkTip`);
- the `browser.openLinks` description promises ⌘ for a new built-in browser tab, while `Links.open` opens the system one on ⌘.

Because of this the graph looks like a separate tool: every block link throws the reader out of the thread, and from Knowledge there is no way to the code. Comparing with other products ([[01a173f9-7465-7470-ae09-82a136d34d5f|link-nav-research]]: VS Code, Orca, T3 Code, Codex — by code; Claude Code desktop, Codex app, Zed, Obsidian, Notion — by docs) showed the shared trick: click opens in the nearest place, the modifier leads further, a peek unfolds into a full page by button (Notion, Arc). The rule takes this trick and makes it the same for all link kinds.

**Terminal** follows the same rule. There is one exception, and it stands on a fact: while the program in the terminal has mouse tracking on (`terminal.modes.mouseTrackingMode` is not `none` — vim, htop, agent TUIs), the click belongs to it, and only Cmd-click opens a link, doing then what click usually does. A click that only moves focus into the terminal panel does not open a link. Double-click on a path first opens it on the right, then selects — as in the thread feed; so opening on the right does not take focus from the terminal. The tooltip at the panel bottom (`LinkTip`) speaks the new words. A site opens on plain click in the built-in browser on the right, on Cmd-click — in the system one; the terminal's present ⇧ modifier goes away.

**Mechanism.**
- **One opening owner — `features/opening`.** It stands below all link showers (feed, block body, Changes, terminal) and knows none above. A link kind is declared by the feature owning the thing, at its own `features/*/links.ts` with a `LinkKind`: the beside place (right-area tab content), the full place, menu items and tooltip words. Declaration assembly is like the right-area tabs (`declaredPanes.ts`): one registry at load, with no central list of others' parts. File declares `checkout`, block — `graph`, commit — `checkout`, thread — `threads`, site — `browser`.
- **Surfaces only call the owner:** `Opening.open(link, 'beside' | 'full')` and one `LinkMenu`. The "where to open" decision is made nowhere else: `FileOpener` becomes the "file" kind's executor, `Links` the "site" kind's, `BlockTitles.open` the "block" kind's; `PathMenu` becomes the "file" kind's menu items.
- **The beside holder** is the same one `FileOpener` already picks for files: the layout of the screen showing the source thread, otherwise the thread's own layout (`ThreadSeats.openFor`), and in a section without a thread — the section's layout.
- **A block tab** is a new view in `features/graph/panes.ts`. Inside is the same block page (`BlockPage`), with no second implementation: its layout already adapts to width (`@rail/page`). The page's claims on the window chrome (`Bar.name`, `Topics.offer`) move to the `/b/[id]` route, otherwise a block in the right area will hijack the window title. The tab holds the graph tier of the copy where the block stands (project and branch from `blockRefView`), so another project's block opens beside just like one's own.
- **A commit tab** is a new view in `features/checkout/panes.ts` on the same parts as the commit card and Changes: `CommitFiles` and the diff view. A commit click in any holder gets it too, including in a section without a thread.
- **"Open in …" in the header** is a declared field of the tab kind (`PaneKind`) shown by the right-area header when present; the file, block, commit and browser-page tab kinds declare it.
- **The hover tooltip** is one component over the shared `Tooltip`; the terminal draws the same words in its `LinkTip`.
- **The `links.click` setting** is `beside` (default) or `section`: at `section`, click and Cmd-click swap places for all kinds. The key is declared next to `appearance.loadInStatusBar` in `settings/contract/wire`. `browser.openLinks` stays: it decides whether the built-in or the system browser counts as the "beside" place for a site; its description is brought to the code.

**Acceptance (performer checks).**
1. For each of the five link kinds, a test through the public `Opening` entry proves: click opens the declared beside place in the needed holder's layout, Cmd-click the full place, a repeat does not open a second tab. At `links.click = section` the places swap.
2. Every surface — feed (answer text, block, commit and thread cards), a block body and its Sources on the block page, Changes, terminal — opens through `Opening`. There are no other "where to open" decisions in the app; checked by code reading at acceptance.
3. A block from the feed opens as a tab on the right, the thread stays on screen; another project's and branch's block opens beside in its copy. The window title stays the thread's title meanwhile.
4. Paths in a block body and Sources rows in the Knowledge section are clickable and open in the section's right area.
5. Terminal: a plain click opens a file and site beside; with the program's mouse tracking on, a plain click does not open a link, Cmd-click opens beside; a focus-moving click into the panel does not open a link; opening beside leaves focus in the terminal.
6. Right click on any link opens its kind's menu with shortcuts at the first two items; Enter and Cmd+Enter on a link do what click and Cmd-click do.
7. The `browser.openLinks` description matches what the code does.

**Out of scope.**
- Thread-graph linkage — what a thread holds and did, starting an agent from a block — a separate spec.
- Links in the code editor: it has no link handling of its own, the rule will come to it separately.
- Desktop windows as an opening place.
- The mobile shell: it has no right area, a click opens the thing at the main place.
