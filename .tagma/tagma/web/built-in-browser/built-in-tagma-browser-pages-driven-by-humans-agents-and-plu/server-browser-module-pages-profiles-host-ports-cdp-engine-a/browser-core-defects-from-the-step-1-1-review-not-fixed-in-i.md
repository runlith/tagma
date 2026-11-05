---
id: 01a1484a-2e3b-77ca-b058-0914c4428b2f
title: "Browser core: defects from the step 1.1 review, not fixed in its delivery"
ord: 2
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a147d6-7ef4-7c9c-9e39-feaa461a081e
---
Delivery [[461a081e]] review (Sol xhigh, Wonder full xhigh, Opus high) found defects not fixed in that delivery: each needs a separate decision or concerns the next host. Confirmed by code reading; no measurements.

- **Screenshot image outside the native door.** `OperationBody.media` is read only by `invocation/nativeDoor.ts`; the HTTP `perform` and the MCP bridge (`cli/verbs/mcpServe.ts`) answer JSON with a file path. For a harness agent to get the image, the operation result must carry media over HTTP and MCP (`image` content) — that is a platform contract, not a browser one.
- **`painted` is set once per session.** `PageHost.session(page, {painted})` cannot switch when a screencast joins an already open session; the engine always asks `true`, and desktop would keep every driven page drawn. A separate `paint` holder count on the port is needed — before the screencast task.
- **Adapter refusal code in the core contract.** `HOST_REFUSALS` holds the managed builds' `build-unavailable`; the next adapter with its own code would require a core edit.
- **No CDP-event backpressure.** Unbounded `PubSub` on every session owner (`packages/cdp/src/session.ts`) and an unbounded `Queue` writing records into the pipe (`pipe.ts`): a consumer lagging behind a heavy page accumulates text in memory. Dropping events would break links and buffers, so the fix is a producer-side limit (which domains are on) or a measured policy.
- **Input not released on interrupt.** `click`, `drag`, and `press` (`packages/cdp/src/input.ts`) release the button and modifiers only on the happy path; `ensuring` with a send into a hung renderer would delay the interrupt itself.
- **Coordinate actions.** `focus` on a point clicks, `check`/`uncheck` on a point toggle blindly, `fill` without a link selects through the top frame's main world (`engine/act.ts`).
- **OOPIF:** the response body (`Automation.body`) is requested in the root session, while `requests` are keyed by one `requestId` with no frame session.
- **Host registry:** remote observer calls (`reconcile`, `Profiles.sweep`) run inside the uninterruptible `Hosts.attach` acquire; a late observer never receives already attached hosts; the `departed` pid lives only in memory.
- **Managed-host small print:** favicon never fills (`faviconUrl` is not read from history); `crashed` takes no part in `gate`; `read_page_downloads` has no `limit`/`total`, and the downloads array rewrites the record line whole.

Done when each item is fixed or declined with a reason in this task.

**Outcome.**
- Image — fixed (`7a7ad49a61`): the HTTP door counts `media` in the operation context on the `tagma-media: inline` header and puts it in `_meta.media`; `tagma mcp serve` sends the header and returns `image` content ([[8e1fddab]]). Verified by typecheck and door tests; no live harness-agent run with a screenshot.
- `painted` — fixed (`65c6403ac7`, `d398345870`): `PageHost.paint(page)` is a scoped hold with a host-side counter; the engine holds it for screenshots and picks inside guarded work.
- Adapter refusal code — fixed (`65c6403ac7`): `HostRefused` without a code, the core returns `host-refused` with the adapter reason. Along the way (`4a199a884f`): a call that reached the host and stayed unanswered refuses with `outcome-unknown` (`HostLost.pending`, `SessionEnded.pending`), as [[255c4582]] requires.
- Backpressure — declined. Dropping events breaks links, buffers, and navigation, and a bounded reader-side queue on the pipe would stop the whole profile browser over one slow subscriber. Domains turn on only on driven pages and drop on idle, but that does not bound event rate or volume: the accumulation risk on a slow subscriber stays and is unmeasured. The decision waits for a measurement; the frame flow measures [[8df087e4]], and that measurement does not cover Console and Network flow on a heavy page.
- Input — fixed (`65c6403ac7`, `d398345870`): `Session.post` with no answer wait; `click`/`drag`/`press` release through it on failure and interrupt, and a modifier is unchecked only after sending.
- Coordinate actions — fixed (`d398345870`): the element under the point is found with `locateAt` (with OOPIF); `focus` focuses the nearest focusable ancestor, `check`/`uncheck` read state, `fill` without a target runs in an isolated world, through same-origin frames, otherwise refuses. Covered by system-test scenarios.
- OOPIF — fixed (`2556ed812e`): requests keyed by frame target, the body requested in that target's current session. No separate test.
- Host registry — fixed (`2556ed812e`): a late observer receives attached hosts; `reconcile` and `sweep` fork out of acquire. `departed` in memory — declined: after a server restart the host reconnects on its own, and a pid saved across server lives may already belong to another process and would hold calls without a deadline.
- Delivery review (Sol xhigh, Wonder xhigh) — fixed (`e6f3db6b61` and the `browser/pages.ts` edit): host observers run outside the uninterruptible acquire but before the host becomes reachable, under a per-observer lock that accounts for what was said — a late observer and a host leaving mid-repeat no longer confuse the order; `reconcile` and `sweep` again complete before `reach`, so an action never opens a page twice; host events subscribe before profile reads; a page whose `open` stayed unanswered stays in the registry, and reconciliation closes pages on the host the registry does not know; an unsent command on an ended session carries the real end reason; a driven page that stops answering between gate and attempt refuses with `page-unresponsive` instead of a defect; `focus` on a point accounts for Shadow DOM and `tabindex=-1`; a late-finished evicted download never becomes "newest"; an image over 5 MiB goes file-only (measured: base64, JSON, and encoding 5 MiB take about 3 ms, one sample on this machine). The `detached` retry on a living page stays: the target the commands left for was closed by the host, and the new page never received them; recorded in [[39241ecf]].
- Managed small print: `crashed` — a `page-crashed` refusal (`2556ed812e`); downloads — the last 50 in the record, reads with `limit`/`total` (`2556ed812e`), rewriting a line of up to 50 records accepted as cheap. Favicon passed to [[8df087e4]] (taken by the performer): CDP `NavigationEntry` carries no favicon, an isolated-world request after load is needed.
