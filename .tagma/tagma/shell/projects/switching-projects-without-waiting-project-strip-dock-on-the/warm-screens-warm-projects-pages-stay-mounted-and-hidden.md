---
id: 01a13d1d-cf8d-7804-a695-42fb6d2aaae1
title: "Warm screens: warm projects' pages stay mounted and hidden"
ord: 7
tags: ["idea"]
fields:
  {
    "status": "open"
  }
---
Question: whether to keep warm projects' pages mounted and hidden, so a move becomes a visibility change, like browser tabs — with scroll, draft and terminals in place.

Why: [[fba4f4d3]] removes the server wait, but the project page still remounts (`{#key standing}`), and a long feed renders from scratch.

What decides: the measurement ([[2516a131]]) of warm returns. If the "frame" stage stays visible, that's the next work; if not, the idea closes.

The sample after warm projects (own instance, a runlith copy, no load): warm-return frame median 117 ms against 173 ms for a cold move; the remainder is remounting the project root, which draws every graph block (127k DOM nodes). The page itself speeds up first — [[cb817a54]]; this idea only if remounting still shows after that.

Cost:
- A project page renders not as a child route but as one scene per warm project, each under its scope.
- Page components that take the project or branch from the window move to their own scope. A non-test `rg` count on 2026-10-15:
  - 38 files read `workspace.active`, `activeId` or `contextProject`;
  - 11 files read `page.params.project`;
  - 12 files read the window's `ProjectRung.Source` or `GraphRung.Source`;
  - 28 files already take `ProjectRung.Current`.
- Hidden scenes must not spend CPU on rendering.
