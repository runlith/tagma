---
id: 01a14c08-1c3f-7bde-a2e3-046726716824
title: "Agent debugs a page: console, network requests with response bodies, and JavaScript in the page itself"
ord: 4
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c08-1c3f-7bde-a2e3-04710dac7353
sources:
  - kind: file
    ref: apps/tagma/server/src/browser/engine/automation.ts
  - kind: file
    ref: apps/tagma/server/src/browser/engine/capture.ts
  - kind: file
    ref: apps/tagma/server/src/browser/engine/local.ts
---
**Value.** The agent debugs a web application on its own: it sees console errors, failed requests and response bodies, and checks page state with an expression.

**How.** The `read_page_console`, `read_page_network` (request list or one response body), and `evaluate_in_page` operations; console-capture tuning is the profile's `console` field (`update_profile`, `create_profile`).

**Behaviour.**
- Console capture needs `Runtime.enable`, which sites read as an automation signal, so capture follows the profile: `auto` turns it on for loopback and private-network addresses, and on any other page from the first console read; `always`; `never` refuses with `console-off`.
- Console text reads as DevTools shows it: objects, arrays, maps and sets from the previews Chromium sends with each live call, a node by its selector, an error by its headline, a function by its signature, format specifiers applied (`%c` dropped); rendering stops once the entry's text is full. Each entry names the console call that wrote it (table, trace, group, assert, count…).
- Stacks stay out of a default read: asked for, each entry carries the stack of the error it logged, else of the call, cut to a few frames; such a read answers fewer rows. One entry is read alone by its `seq`.
- Filters: level and above, text or URL substring, continuation after `seq`; `dropped` counts records evicted from the buffer. The network list filters by URL substring and "only failed and 400+ responses".
- A console read waits for the engine to apply events already received when capture is synchronized; later logging does not extend that wait. CDP replies and queued event handling advance independently, so a successful DOM observation alone does not make the console buffer current. Navigation preserves captured history.
- A response body is available while the page holds it; a long one is cut.
- `evaluate_in_page` runs an expression in the page's main frame, waits for the promise, and answers with JSON or an exception text; the page sees what the expression does.

**Limits.** Console and network buffers fill only while the engine is attached to the page: what came before the agent's first action or after an idle page disconnected is not recorded. Messages Chromium replays when capture starts carry no previews, so their objects read as class names. Access matches [[4096201b|agent-driven pages]].
