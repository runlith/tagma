---
id: 01a165b3-4050-7292-999c-e1cf18dd9e6b
title: "Tagma live marks are sign tiles in one phase: waiting is three tiles, work is one breathing tile, gold is only the current one"
ord: 64
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a165a0-169a-73bc-bca9-0d8384487d7b
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/Life.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/shared/ui/Working.svelte
  - kind: file
    ref: packages/chat-ui/src/ContextRing.svelte
  - kind: file
    ref: packages/chat-ui/src/inStep.ts
  - kind: file
    ref: packages/chat-ui/src/Waiting.svelte
---
Tagma live marks are sign tiles in one phase: waiting is three tiles, work is one breathing tile, gold is only the current one.

The mark shape comes from the Tagma sign — a crest of square tiles with one gold in front. What Tagma does (thread, project, command) is drawn as a tile. Context share is also a square: a frame the share fills clockwise around the perimeter from the middle of the top side, with compression running around it in `--beat` steps; so the operator decided, though a share reads easier by arc angle than by square perimeter. Provider quota is a crest of five 20% tiles next to its mark (`Gauge`). In a six-provider footer row it is quieter than the frame, with the exact number beside it. Context stayed a frame: its compression runs around the frame, while on the crest it would read as waiting. Vendor marks are drawn by vendors, their shape does not change.

**Waiting is three tiles, not one.** Stop buttons (`CallControls`, `CommandActs`, `WorkLine`, `WorkPeek`, `LoadRow`) show a square Stop and change it to the waiting mark while stopping: one square tile in its place would read as a blinking "stop". So `Waiting` is three tiles in a row lighting up in turn; every spinner in the app and chat is drawn by it.

**One phase.** A CSS animation starts when its element is inserted into the document, and rows mounted at different times would blink out of phase. `inStep` sets every animation under the element to `startTime = 0` on the document timeline: marks with one `--beat` duration go in one phase, and crest step delays are kept. Mark animations are `animate-breathe` and `animate-march` from the chat theme, both on `--beat`; a new animated mark takes one of them and hangs `inStep`. An animation switched by a class change on an already mounted element is not caught up by `inStep`: such a mark is drawn as a new element — `Life` renders `Working` with its own branch, `RailRow` and `CommandMark` recreate the mark on its class change. `inStep` reads the animations, which forces a style recalculation, so a mark that may stand still hangs it only while it moves: a feed mount of settled steps recalculated style once per step.

Feed steps are also square tiles on a thread; a running step breathes together with the "working" tiles in the list. Change stays blue (`--chat-mutation`) by the operator's decision, though the tone stands 12° from "waiting for you".

**Gold is only "you are here".** `--brand` (and `--chat-here` in chat) stands on the ruler mark of the current place, the open thread ruler, the current model, and the current navigation message. Waiting and work are not drawn in gold: work is amber `--status-in-work`, neighboring in tone (68° vs 88°), and the two meanings would merge.
