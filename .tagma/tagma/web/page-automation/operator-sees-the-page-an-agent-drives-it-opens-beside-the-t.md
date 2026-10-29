---
id: 01a14c08-1c3f-7bde-a2e3-0469ea44a461
title: "Operator sees the page an agent drives: it opens beside the thread, shows the agent's cursor, and is taken over by the operator's own input or by opening DevTools"
ord: 6
tags: ["feature"]
fields:
  {
    "state": "live"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/browser/OpenPages.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/browser/TabStrip.svelte
  - kind: file
    ref: apps/tagma/desktop/src/browser/driven.ts
  - kind: file
    ref: apps/tagma/server/src/browser/engine/cursor.ts
  - kind: file
    ref: apps/tagma/server/src/browser/engine/drive.ts
  - kind: file
    ref: apps/tagma/server/src/browser/engine/operator.ts
---
**Value.** The operator sees where the agent works and can look or step in at any moment: an agent page is an ordinary tab, not an invisible process, and stepping in needs no button.

**How.** The browser panel, the phone Pages section, and tabs show every project thread's pages with a mark that an agent drives the page; the agent's cursor drawn on the page itself; the operator's own input on the page; the operator's DevTools on desktop.

**Behaviour.**
- When an agent opens a page while its thread is on screen and the browser panel is not, the panel opens itself with that page.
- The "driven by an agent" mark holds while the thread's run is going or less than half a minute passed since the last action; on the phone the page line says "An agent drives it".
- Each agent action shows where it lands: an arrow at a viewport point, an outlined box around the element it acts on. Chromium draws it over the page (the DevTools overlay), so the native view and every screencast viewer see it and the page's scripts do not; it stays about two seconds after the action. The agent's own captures and a pick's picture are taken with every overlay of ours — this cursor and the pick highlight — lifted for that moment.
- The operator's own input on the page — a press, scroll, key or drag in the native view on desktop, or the same through a screencast viewer — takes it over: navigating, acting, emulating and evaluating by an agent refuse `operator-input` until that input has been quiet for five seconds; a step already running finishes, and a sequence stops before its next step. Reading the page stays open to the agent. Hovering alone takes nothing over.
- Open DevTools take the page over: the engine disconnects, agent actions refuse with `devtools-open`, and after DevTools close the engine reconnects on its own.

**Limits.** There is no explicit "take over" or "hand back to the agent" button. While the operator picks an element, the agent's cursor is not drawn. The operator's own calls — navigation from the panel — are never held. Desktop detection of native input is proven by reading the code only, not by a run under Electron.
