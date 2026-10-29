---
id: 01a13de3-3666-788b-8836-96ddcb817a54
title: "The project root draws every graph block: on runlith 127k DOM nodes and 156 MB heap, the outline tree and the knowledge column are not virtualized"
ord: 12
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a13d57-c92a-783c-bbf3-4ad4e8790af7
  - kind: relates
    to: 01a13d1d-cf8d-7804-a695-42fb6d2aaae1
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/outline/Tree.svelte
---
On the project root (`routes/[project]/+page.svelte` → `BlockPage`, the `features/graph/outline/Tree.svelte` tree) and in the knowledge column (`SidebarTree`), the page cost grows with the graph, not the window. A sample on the runlith copy (3,131 blocks, its own instance, no load): 127,738 DOM nodes, 9,368 listeners, 155.8 MB heap after GC; an empty project on the same page — 4,237 nodes and 27 MB. About 41 nodes per block. A conclusion from code, not a measurement: recursive `{#each}` with no virtualization, `Row.svelte` expands the subtree when `expanded || readingLens.active`.

Why it matters: after warm projects ([[e8790af7|warm projects]]) this is the main remainder of the transition time — frame median 117 ms on a warm return vs 173 ms on a cold one, the remainder is this page's remount ([[6d2aaae1|warm screens idea]]). And it is the memory of every open project root ([[2393aff1]]).

Start from one `querySelectorAll` snapshot over outline rows and sidebar rows — which of the two draws the nodes. Then, at the tree owner, draw only the visible rows over a flat projection of the expanded tree, keeping expansion, search, the reading lens, and anchor scroll.

Done when on the runlith copy the root's DOM node count grows with the window height, not the block count; the before/after measurement — by sample.
