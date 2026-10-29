---
id: 01a1181c-0f04-7883-b579-1fd4cf3d78a6
title: One document cell serves all subscribers; it sends a delta only if it reproduces the text, otherwise whole
ord: 1
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/checkout-files/documents/current.ts
  - kind: file
    ref: apps/tagma/server/src/checkout-files/documents/edits.ts
  - kind: file
    ref: apps/tagma/server/src/checkout-files/documents/open.ts
---
There is one document cell per (checkout, real path) pair for all subscribers. It holds the previous text for calculating line deltas, so an event on the path costs one stat, and a changed state costs one read and one diff. A document opened through a symlink lives in its target's cell; subscribers never see the link itself retargeted.

- Client text is lines with LF and no BOM; CRLF and BOM stay in bytes. So the `digest` counts over the file bytes, while line edits apply to the normalized text: a write layering them onto bytes must preserve untouched lines' separators.
- A delta goes out only if applying it to the previous text reproduces the new text exactly and the mode (`readOnly`) did not change; otherwise (including when only a final newline changed, which `LineEdit` cannot express) the subscriber gets `whole`.
- The stat key is remembered only if it matched before and after the read: a file changing mid-read never pins bytes to a key that no longer describes them. A repeated event with the same bytes reads the file but never reaches the diff: the digest comparison runs first.
- A new subscriber gets `whole` under the cell lock and no deltas before it, so the first frame always describes the state the following ones count from.
- Held texts sum to a bounded share of memory, always exactly the cell texts still holding subscribers: accounting shifts in one place, a released cell detaches. An evicted cell remembers the `digest` but not the text: if the file did not change, the text silently returns; if it did, subscribers get `whole`.
- A subscriber with more pending frames than the limit gets one `whole` instead of the tail. A read failure is an `unreadable` frame, not empty text. A diff past the inline threshold or an unavailable worker loses no write: the subscriber gets `whole`.
- A missing path the change record knows as a move source gets `moved {path}` instead of `gone`; the operator's write shifts the cell itself ([[9dddba66]]).
