---
id: 01a185ac-c96a-7e60-92c3-5b9f47499208
title: Build an accessibility audit of a page with axe-core in the engine's isolated world
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a185ad-5da3-725c-ba34-4c1650ab5975",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a184dc-4fbe-7b01-a2d5-4fac647a38eb
---
The fifth step of the parent spec, as the operator decided there: Lighthouse's most useful category without Lighthouse, `Runtime.enable` or storage resets. axe-core is pinned and injected into the engine's isolated world of each frame the page holds, out-of-process frames included (axe's partial runs per frame, finished in the root), so the page's own scripts never see it. The answer lists the violations by rule — impact, what fails and how to fix it in one line, the WCAG tags — and every failing node as a ref of the page's snapshot the agent can act on at once, bounded by `limit`; incomplete checks are counted, not listed. The agent may narrow it to a ref's subtree and to rule tags. Heavy work stays off the server loop. Name, operation shape and refusals follow the existing page tools.

Acceptance: a test page with an image without alt text, a low-contrast label and a cross-site iframe holding a button without a name yields those three violations, each node a ref that a click or snapshot resolves; the page's main world sees no axe global; a run on a page under DevTools or with an open dialog refuses as any action does.