---
id: 01a147eb-fd80-705f-993f-174d5515e456
title: A write that changes every thread's start answers with a price through a platform port filled by the start-composition owner
ord: 24
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/operations/start.ts
  - kind: file
    ref: apps/tagma/server/src/platform/contract/service/start.ts
---
The change's cost is counted by the same start-composition owner (native-harness), while the write answering it lives below — in graph and settings. So the `StartCosts` port stands in platform, and native-harness fills it. A write declares which part of the start it moves: the law or dictionary (`law`), or the graph note with a map (`graph`). `priced` measures only that part with the agent opening the project's new thread (`agent.default`, by default `tagma`), before the write and after it — the delta is the difference of those two measurements — plus one full composition after the write, to name the start cost now: `{ agent, chars, delta }`. When measuring fails, the answer carries `{ unmeasured }` with a reason, while the write itself stands.

Measuring a `law` write before it is cheap: the law set is cached by the project's law revision. A full post-write composition includes the prime render with the map; one sample on the operator's machine is a 250–300 ms map render on the runlith graph. So only writes that change every thread's start take the price: a block whose type carries the law, or a tag and catalog declaration (`lawShapingTypes` — the same list by which graph moves the law revision), including creation by contract through the default type; a rule's enable and delivery switch; a setting declared with `shapesStart`. A code rule also measures and answers a zero delta: so its author sees `code` costs the start nothing. `apply_batch`, subtree deletion and restore, `anchor_block` and `unanchor_block` measure quietly: the answer carries a price only when the delta is nonzero. A root type never decides the touched blocks' types; with a rule lacking explicit delivery the first or last source switches it between `prompt` and `code`. Replacement and replacement withdrawal measure the price by the replaced block's type.

Answer boundaries. The base is this agent: when it holds no `graph`, the dictionary is not part of its start, and a tag edit answers a zero delta; a non-native agent is `unmeasured`. The before and after measurements are not pinned to one revision: a law another session wrote in between lands in this write's delta.
