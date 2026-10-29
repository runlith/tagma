---
id: 01a184c6-5f74-78fd-936b-279a754ec833
title: "A click by reference on a scrolled page refuses element-obscured \"by nothing\": the cover check hit-tests in the wrong coordinates"
ord: 11
tags: ["task"]
fields:
  {
    "holder": "tagma:01a184c6-8f6b-71e9-98e2-0a66c889a201",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a18447-5a5c-755d-a1dc-42d84d9baba3
---
Seen 2026-10-29 on the desktop host (Electron 44.8.0, `agent` profile), Wikipedia article page. The page was scrolled to `scrollY` 851; its fundraising banner sat in a fixed container with the close button at viewport (533, 17), 32×25, and `document.elementFromPoint` at the button's centre returned the button's own SVG `<path>`. `act_on_page` `click` on its reference refused `element-obscured: … covered at its click point by nothing at that point of the viewport`. After `window.scrollTo(0, 0)` the same reference on the same document clicked and closed the banner.

"Nothing" comes from `coverOf` in `browser/engine/target.ts`: `hitAt` sends `DOM.getNodeForLocation` with the point `pointOf` derived from `DOM.getContentQuads` (viewport coordinates) and turns its refusal into `null`. The one scrolled sample points to `getNodeForLocation` reading its x/y in another space than the quads (document coordinates, scroll included) — inference from the sample, to be confirmed in Chromium's source or by measurement. If it holds, every click by reference below the first screen is refused or judged against the wrong node, since `boxOf` scrolls the element into view first; coordinate `focus` (`locateAt`) may share it. The shared scenarios (`browser/testing/scenarios.ts`) have no scrolled page, which is why they stay green.

Done when a scenario clicking by reference an element that needs scrolling — in normal flow and in a fixed container on a scrolled page — fails before the fix and passes after, on the managed host; and an obscured element on a scrolled page still refuses naming its real cover.

Confirmed in [Chromium 151.0.7922.71](https://github.com/chromium/chromium/blob/151.0.7922.71/third_party/blink/renderer/core/inspector/inspector_dom_agent.cc#L1734-L1772): `getNodeForLocation` reads document CSS coordinates and calls `DocumentToFrame`, which subtracts the layout scroll offset. `hitAt` now adds the selected session's `cssLayoutViewport.pageX/pageY`; `offsetOf` remains viewport-relative. Two shared operation-level scenarios were red before the fix: flow and fixed-SVG clicks refused `element-obscured` covered by nothing, coordinate focus refused `action-failed`, and independently scrolled OOPIF input failed likewise. After the fix the managed engine file passed all 16 tests on seeds 1/2/3, including real cover names in the main, outer-frame and child-frame cases; server `bun run typecheck` passed. Desktop CDP forwarding was read through to `webContents.debugger.sendCommand`, but Electron was not launched and desktop execution remains unproved.