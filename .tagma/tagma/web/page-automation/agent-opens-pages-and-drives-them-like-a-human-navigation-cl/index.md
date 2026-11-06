---
id: 01a14c08-1c3f-7bde-a2e3-04644096201b
title: "Agent opens pages and drives them like a human: navigation, clicks, input, keys, selection, drag, file upload, and waiting"
ord: 1
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a147b0-e165-75df-b2b0-9a0cf3ea399e
  - kind: relates
    to: 01a14bae-6720-7d62-897a-927fda029bcc
  - kind: relates
    to: 01a14bae-6720-7d62-897a-928acad90fdf
  - kind: relates
    to: 01a14bae-6720-7d62-897a-928db50ae262
  - kind: relates
    to: 01a14c08-1c3f-7bde-a2e3-046576c9a0f3
  - kind: relates
    to: 01a14c08-1c3f-7bde-a2e3-04667317c320
  - kind: relates
    to: 01a14c08-1c3f-7bde-a2e3-046726716824
  - kind: relates
    to: 01a14c08-1c3f-7bde-a2e3-0468add6b3fa
  - kind: relates
    to: 01a14c08-1c3f-7bde-a2e3-0469ea44a461
  - kind: relates
    to: 01a14c08-1c3f-7bde-a2e3-046b8ddec8bc
  - kind: relates
    to: 01a14c08-1c3f-7bde-a2e3-046de2a2ecf8
  - kind: relates
    to: 01a14c08-1c3f-7bde-a2e3-046f00d856ce
  - kind: relates
    to: 01a14c08-1c3f-7bde-a2e3-04722a082541
sources:
  - kind: file
    ref: apps/tagma/server/src/browser/contract/wire/capability.ts
  - kind: file
    ref: apps/tagma/server/src/browser/contract/wire/pageOperations.ts
  - kind: file
    ref: apps/tagma/server/src/browser/contract/wire/shape.ts
  - kind: file
    ref: apps/tagma/server/src/browser/engine/act.ts
  - kind: file
    ref: apps/tagma/server/src/browser/engine/drive.ts
  - kind: file
    ref: apps/tagma/server/src/browser/operations.ts
  - kind: file
    ref: apps/tagma/server/src/browser/pages.ts
---
**Value.** The agent walks a scenario in a real browser — sign-in, form, SPA, file upload — on the same pages a human sees, with no separate Playwright or Chrome DevTools MCP.

**How.** The `open_page`, `navigate_page`, `act_on_page`, `wait_for_page`, `answer_page_dialog`, `close_page`, `list_pages`, and `read_page_downloads` operations; agent tools in the `browser` capability, the HTTP, MCP, and `tagma op` doors, admitting an external caller — plugin processes.

**Behaviour.**
- Searching for `open_page` reveals `snapshot_page` and `capture_page` with it; the opening answer prints ready calls for the page it opened. Action tools are revealed separately.
- Without `profile`, an agent page opens in the `browser.agentProfile` profile; a profile whose host is disconnected refuses with `host-away` and names the profiles of connected hosts — no profile substitution. The thread's last opened or touched page becomes its default page.
- Actions — click, double click, hover, fill, type, key, select, check, scroll, drag, file upload from the checkout, focus — target a link from the snapshot or coordinates. Before a click the element scrolls into view; if revealing it moves its placement or an enclosing frame, the action requests a root redraw before answering. Immediate coordinate input after an intermediate out-of-process ancestor scrolled remains unproved; ref input still uses the descendant's session. A covered point refuses with the name of the covering element. Input does not steal the operator's screen focus.
- The navigation answer arrives after the document commits, before loading; waiting for load, text, URL, or a visible element is `wait_for_page` within the stated deadline.
- A call carries an ordered action sequence and holds the page queue until it finishes, so other automation calls cannot interleave. The first refusal stops the sequence with its original code and recovery guidance, naming the stopping step and completed steps. An opened dialog also stops the sequence and is returned with the page state. Earlier effects remain; an unknown outcome is not retried.
- Agent navigation respects the operator's domain lists, including redirects, frames and popups, without limiting the operator's own navigation.
- Browser operations never ask for approval, in any thread mode.

**Limits.** The tools reach the built-in `tagma` agent (the capability joins it, deferred, with a prompt line on when to take the browser), agents extending it unless they narrow their capabilities, agents declared by file with `browser` in `capabilities`, foreign CLIs through `tagma mcp-serve`, and apps. A thread whose overlay narrows its capabilities without `browser`, or whose `tools` list leaves the browser tools out, does not get them.
