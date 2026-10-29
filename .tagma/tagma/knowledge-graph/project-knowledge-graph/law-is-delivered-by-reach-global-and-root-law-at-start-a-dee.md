---
id: 01a0c87c-9b36-7d22-9b36-467719851665
title: "Law is delivered by reach: global and root law at start, a deeper rule at the act that touches its region"
ord: 143
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/orientation/Instructions.ts
  - kind: file
    ref: apps/tagma/server/src/graph/orientation/Orientation.ts
  - kind: file
    ref: apps/tagma/server/src/graph/orientation/Touches.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/agents/composeAgent.ts
  - kind: symbol
    ref: apps/tagma/server/src/catalogs/contract/wire/softwareDevelopment.ts
    symbol: rule
---
Every law-carrying block of a project is delivered in full to every thread of that project. Measured here on 2026-09-22: 84 rules at roughly half coverage of this repository, on the way to ~170, riding every instruction refresh of every thread whatever the thread works on. The containing region is printed as a LABEL and the reader is asked to respect it — "Apply each obligation only within its labelled scope" — while `#rule` declares that local reach follows the containing region. The declaration and the delivery disagree, and the delivery is the one that costs every turn.

Accepted: the server routes law by reach. The label becomes the routing key rather than a request to the reader.

## The outcome

1. **Global law rides in full at start**, unchanged. It binds every project by construction, so there is no region to route it by.
2. **Project root-level law rides in full at start**: a rule whose family container is the project root binds the whole project — how work is done, not which file — so it must stand before the first act.
3. **A rule under a module or an area does not ride at start.** Not as a body, not as a title, not as an index. An index is refused deliberately: it grows linearly with the rule count exactly as the bodies do, and a reader handed a list of titles it cannot apply is paying for the growth without buying the law.
4. **A deep rule arrives at the act it binds**, by three triggers:
   - the session holds a task — the law binding the task's own position and the regions its sources name rides its work brief;
   - a scope was named when the thread opened — that scope's law rides the instruction set from the first step, and stays in it;
   - the session touches a path the rule's region covers — the rule rides the touch brief of that call, whole.
5. **The region label is the routing key.** The server does not hand a rule to a session that does not work in its region; the label on a delivered rule says which region it came from, and the reader still applies it only there.
6. **A delivered rule carries title and body together**, on every road. A body exists only where the title cannot be applied without it, so a title alone is a rule nobody can obey.
7. **Delivered law is never withdrawn for leaving a region.** The session may already have acted on it. The instruction set carries forward every law entry the reader was already handed, so only a rule that was withdrawn, disabled or superseded leaves the set — as today.
8. **Each rule rides in full once per thread, then not again**: the existing revision/scope delta on the instruction road, and the existing identity+version ledger on the touch road. Neither discipline changes.

## What the touch trigger guarantees, and what it cannot

A touch is recorded and answered at the tool boundary, after the tool ran. Every runtime guide this loop produces — from `beforeTool`, `afterTool` or `beforeStep` alike — is queued and injected into the NEXT model call, so no guide can be placed in front of the act that provoked it.

So the guarantee is: **the rule arrives in the same turn, in the guidance the model reads before its next step.** For a read, that is before anything is decided on what was read. For an edit or a write, the bytes are already in the file: the rule arrives immediately after, and before the next act. Promising delivery before an edit takes effect would require the door to deliver guidance synchronously into the tool's own result, which this loop does not do.

The second limitation: the touch road covers the file tools — `read`, `edit`, `write` — and not a shell command that moves a file, nor an anchor written onto a path. Those places are touched by the operator's definition and are not answered. They are a task under this decision, not a silent gap.

The third: a region is matched to a place by the sources the graph carries. A directory source covers what stands under it; a file source covers exactly that file. Code no region draws reaches no rule, and no measurement says so.

## Acceptance criteria

- A thread of a project with law under a module receives, at its first step, every global rule and every root-level rule with its body, and no rule hanging under a module or an area — no body, no title, no count.
- A thread opened with a scope receives, at its first step, the law binding that scope: the families whose container stands above it or inside it.
- A session that reads, edits or writes a file inside a region receives that region's rules, title and body, in the guidance before its next model step.
- A session in module A never receives module B's law until it works in B.
- A rule once delivered to a thread stays in that thread's instruction set after the session leaves the region, and rides again only when its own text changes.
- A rule withdrawn, disabled or superseded is withdrawn from the set, as today.
- A work brief carries the law binding the task's position AND the regions the task's own sources name.
- `graph_overview` bare still prints root law only; `graph_overview` scoped still prints the scope's whole chain. Unchanged.
