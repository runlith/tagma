---
id: 01a147b0-e165-75df-b2b0-9a0fe3064958
title: "Browser panel in the client: tabs, a native view or a screencast for every page, element to chat, links, and settings"
ord: 3
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
The Tagma client (`apps/tagma/app/src/lib/features/browser/`) shows pages, drives navigation, and hands elements to chat. Everything that changes a page goes through the [[39241ecf|browser module]] operations: one path for desktop, web, and phone.

**Panel.**
- A new `browser` side-panel view ([[a562a1a3|side panels]]): width, seams, eviction, and layout restore stay shared. A panel has its own id and current page; the panel restores with its page. Several browser panels can stand side by side.
- For that, `SidePanes` gets two things: switching any view's panel content (today only thread panels change `id`) and opening without eviction — "only when there is room".
- The panel tab strip is the project's pages from the `browser.pages` feed, filtered: the operator's pages and the focused thread's pages. Picking a tab changes the panel's current page. An agent-driven tab is marked; a thread-opened page shows which thread.
- Toolbar: back, forward, reload and stop, an address bar with history and completion (a non-URL goes to the default search engine), find in page, zoom, DevTools, the new-tab profile, element-pick mode, open in system browser.
- Panel keys — new tab, close, reopen closed, address bar, back and forward, reload, find — register in the application keyboard-map service; it also hands them to the desktop host ([[255c4582|keys and focus]]). ⌘W and ⌘⇧T in the browser panel close and bring back the page.
- The panel draws page dialogs (`alert`, `confirm`, `prompt`, "leave the page?") from the page's live state and answers with an operation.

**Page view** is a `PageView` port with adapters. One predicate in one place picks the adapter for each page: whether the page's host is this desktop's bridge host (`tagmaDesktop.browser` reports its id). On desktop the adapters work side by side.
- native — this desktop's page: the panel hands the bridge a rectangle and visibility, freezes the view while an overlapping layer is open or a drag runs;
- screencast — everything else: web, phone, a managed-Chromium page ([[eb1e2301|screencast]]);
- build window — a windowed managed-Chromium profile (stage 2): the panel shows that the page is open in a build window and brings it forward.

**Links.** One client link router decides where a link from the feed, markdown, terminal, or editor goes: with "Open links in the built-in browser" on — as a panel tab, with the modifier — to the system browser. `installExternalLinks` in main stays the path to the system browser for what the router sent there, for surface `window.open`, and for plugin-view windows.

**Agent on screen.**
- A page opened by the thread shown in the window lands in the panel beside it only when the panel fits without evicting another; otherwise a feed card opens it.
- A browser-tool call in the feed is a card with the page, the action, and — for `capture_page` — the frame; the card opens the page in the panel.

**Element to chat.**
- Pick mode turns the page's pick operation on; the page itself draws the highlight under the pointer (CDP `Overlay`), so the mode works in the native view and in screencast alike.
- A click adds an attachment to the input field of the thread the operator last worked in: the element description, its frame, and the link. Several elements can be picked in a row; Escape leaves the mode.
- The agent receives the attachment as text with the page id and link plus an image, and acts on the link at once, with no snapshot.

**Settings, the "Browser" section.** Profiles (create, rename, delete, clear data), the user profile and the agent profile ([[f3ea399e|defaults]]), cookie import ([[eae10179|import]]), desktop identity (cleared or native, through the bridge, with an application restart), link routing.

**What the performer proves.** Client-contract tests: `PageView` adapter choice by page host and bridge-host id; the tab strip follows the filtered page feed; the panel restores with its page; a pick attachment goes to the thread the operator last worked in; "only when there is room" opening never evicts another panel; the router sends a link to the panel or the system browser by setting and modifier.

**What the operator checks.** Tabs and the address bar, ⌘-click on a feed link, picking several elements and sending them to the agent, a panel beside the thread when the agent opens a page.
