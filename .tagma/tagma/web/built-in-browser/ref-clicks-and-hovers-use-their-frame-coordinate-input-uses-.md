---
id: 01a184c8-ed02-7c9c-a5de-26790a53c2ac
title: Ref clicks and hovers use their frame; coordinate input uses the painted viewport
ord: 12
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/browser/engine/act.ts
  - kind: file
    ref: apps/tagma/server/src/browser/engine/target.ts
---
Reference-targeted hovers and clicks use the element's owning CDP session at its local viewport center; outer-page coordinates remain for cursor placement and cover checks. Chromium's [AX root read](https://github.com/chromium/chromium/blob/151.0.7922.71/third_party/blink/renderer/modules/accessibility/inspector_accessibility_agent.cc#L251-L278) updates the accessibility cache and answers without awaiting a compositor submission, so DOM/AX readiness does not establish that a new frame has painted. Chromium's [InputHandler](https://github.com/chromium/chromium/blob/151.0.7922.71/content/browser/devtools/protocol/input_handler.cc#L1297-L1334) resolves the root widget's target separately for each mouse event, without the compositor synchronization it applies to wheel events. A DOM link must not be reinterpreted as a point in that older surface. Revealing a ref requests a root surface only when its local center or an enclosing widget origin moves; unchanged placement forces no frame. This request does not establish compositor submission by an intermediate out-of-process widget: an immediate root-coordinate click after a ref-driven scroll there remains unproved, while ref clicks into its descendant still use that descendant's session. These components are compared separately because nested scrolls can cancel their sum while changing the cross-widget transform.

Chromium 151 [submits hit-test regions with the compositor frame](https://github.com/chromium/chromium/blob/151.0.7922.71/components/viz/service/frame_sinks/compositor_frame_sink_support.cc#L683-L698), [selects them by the active frame index](https://github.com/chromium/chromium/blob/151.0.7922.71/components/viz/service/hit_test/hit_test_manager.cc#L92-L120), and [aggregates them before drawing and swapping that frame](https://github.com/chromium/chromium/blob/151.0.7922.71/components/viz/service/frame_sinks/root_compositor_frame_sink_impl.cc#L845-L849). A native or screencast viewer acts on that painted viewport, whose frame carries its routing regions, rather than on DOM readiness. Coordinate input, from an agent or an operator, therefore stays on the root path: its subject is the composited viewport, not a DOM link.

`DOM.getNodeForLocation` reads document CSS coordinates. `hitAt` adds the selected session's layout-viewport scroll offset immediately before that command; parent-frame offsets and cursor placement remain in viewport CSS coordinates. Main-frame and out-of-process-frame scroll offsets are independent, so using the outer page's scroll for a child, or adding scroll to the frame-owner offset, tests a different node from the one the input reaches.

Chromium can resolve generated content as a [`CSSPseudoElement`](https://developer.chrome.com/release-notes/147#csspseudoelement-interface), whose ancestry is `parent` rather than DOM `parentNode`. Cover checks must reach its originating element just as they follow text descendants and shadow hosts; otherwise a button's own generated label is refused as an unrelated `#text` cover. A generated cover belonging to another element still refuses and is named by that element.
