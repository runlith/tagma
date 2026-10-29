---
id: 01a1181c-0f11-783b-81be-cb9a4407e137
title: A CheckoutWatch subscriber gets a collapse of paths since the last delivery, and a rescan on overflow
ord: 5
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/workspace/watch/pending.ts
  - kind: file
    ref: apps/tagma/server/src/workspace/watch/shared.ts
---
A `CheckoutWatch` subscriber gets not an event queue but what has accumulated since its last delivery: movements (`tree`, `head`, `index`, `refs`, `config`, `ignore`, `operation`), a set of paths with event kinds, and, where the paths cannot be enumerated, a rescan reason.

- A path named by `rename` stays `rename` even if a `change` follows: the directory membership changed, and a client that only needs membership must not lose it.
- `unnamed`, `error`, `lost`, `polling`, `overflow`, and `reopened` are rescans: path names are dropped, and the consumer rereads everything it shows. `overflow` fires when names exceed a limit derived from machine memory; without it a slow subscriber would accumulate memory for events it will process in a single pass anyway.
- The opening rescan (`opened`) is not delivered to the subscriber: it starts from its first read.
- A dead watcher (`lost`, `error`, `polling` — the machine gave no descriptors) is reopened by the owner, not the consumer: with a growing pause while subscribers remain. Every subscriber learns of the loss through a rescan, and of the return through `reopened`; events in between are missed, so `reopened` reads as "reread everything". A watcher moves the same way when the root with the same `rootId` stands at a different path.
- An open failure removes the record entirely; the next subscription opens anew.
- `ignore` is a change of `info/exclude` or an external excludes file that git picks via `core.excludesFile` or the standard XDG path. That movement immediately rebuilds the path index. A git config change rereads the excludes-file path; if it changed or went empty, the watcher sends the same movement.
