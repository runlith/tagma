---
id: 01a184e6-94de-7876-973b-749de60a460d
title: A teardown inside a guarded branch lets the rest of the sync traversal run that branch's effects over null
ord: 44
tags: ["task"]
fields:
  {
    "holder": "tagma:01a184d1-8cd0-7ace-bf82-27df9fb4e487",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a18394-2fd1-7c82-b7b8-a3a8fa0fe45f
---
Without async mode a branch a block leaves is destroyed inside `Batch.#traverse`. When that branch stands inside `{#if x !== null}` and its teardown clears `x`, the outer guard is marked but the traversal keeps walking the guard's subtree: render effects, `$effect.pre` and blocks after the removed branch run during the same traversal and read `null`. Hunk 10 of `patches/svelte@5.57.0.patch` collects the marked guard only to update it before the batch's queued effects, which is too late for these.

Shape, for a trap beside `packages/layer/src/svelte/passed-guard.svelte.test.ts`: `{#if grip !== null}{#if holding}<Holder/>{/if}<b>{grip.size}</b>{/if}`, Holder's teardown sets `grip = null`, then `holding = false; flushSync()`.

The fix decides where the traversal waits: either it updates the collected guard before walking further into it (the walk climbs out of a destroyed subtree by `parent`, which `destroy_effect` keeps), or it holds the effects under a collected dirty guard and schedules the survivors after the drain. Either keeps `old_values` correct for later teardowns in the same traversal and leaves async mode, where `should_defer_append` forbids a collector during the traversal, unchanged. Then the guarantee in the frontend skill's "Svelte mode and guarded branches" covers the guarded branch's own teardowns too.