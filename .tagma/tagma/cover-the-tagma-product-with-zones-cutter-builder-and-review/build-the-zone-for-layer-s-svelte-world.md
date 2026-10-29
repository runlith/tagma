---
id: 01a0c702-1901-7eda-b145-3e11572c8904
title: Build the zone for layer's Svelte world
ord: 64
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c713-298f-7859-9825-13309c806c3e",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c700-4cde-7cce-8b46-dc3859cc3c49
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: dir
    ref: packages/layer/src/svelte
---
Fill [[1a712a78]] with the claims its code establishes. Read `src/svelte/App.svelte.ts`, `src/svelte/detach.ts` and `src/svelte/index.ts` whole, with `src/svelte/App.test.ts`, `src/svelte/detached-root.svelte.test.ts` and `src/svelte/screen.test.ts`; `src/svelte/screen.svelte.ts` belongs to [[a396564e]] and the test door to [[33d7f6dd]], so claim neither. Watch: what a nested effect root does to a scheduled flush and what the detachment buys — the reason is in the code and it is the sharpest claim of this area; why the server's hooks build inline and start at open while the tab starts at mount; how an override and a held scope narrow a subtree without a second graph; and which of these doors are component-init only. The module states that nothing under the kernel imports Svelte — [[76d45bde]]. Every claim hangs under that area, bound to the narrowest sources that can contradict it and verified after a reading of all of them. Done when the area's body is corrected wherever the code contradicts it, `run_doctor` over its paths leaves nothing open, and a review passes. The module is [[59cc3c49]]; the reference shape is the Git kit [[adeeb4ba]].