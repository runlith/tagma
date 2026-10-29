---
id: 01a0c4f7-921e-7936-b779-ef257a3ab368
title: "D-1: the terminal that appears only after leaving and returning — four silent causes, start 5da825ed6"
ord: 2
---
D-1: a harness thread's terminal appears only after the reader leaves the page and comes back; on first open the page says `This thread holds no terminal` over a CLI running perfectly well.

- **Start commit.** `5da825ed6` — the parent of the first repair. The brief supplies the symptom, the operator's path (`+` → a harness row → the thread page) and nothing else.
- **Reference repair, withheld from workers.** Four commits: `c8d3ad076` (custody of the pty moves to the operator; the run writes the execution onto the thread's `harness` facet; the page mounts the pty the thread NAMES instead of searching the roster by `heldBy`), `2d40b4de5` (`wireThreadSchema` declares `harness` — Effect Schema silently DROPPED the undeclared field on decode, so the server sent it and the page never saw it — and the run publishes a frame after the facet write), `d51089de7` + `9065ffc95` (`HarnessTerminal.svelte` read the address once through `untrack`; the address lands a beat after the mount, so the page kept the null it was born with — `open(execution)` now takes it on every change).
- **Why it is hard.** Four causes, four layers, no error anywhere; three of them must be fixed before the symptom moves at all, so a contestant fixing one sees no progress and doubts it. The masking is the trap: leave-and-return "fixes" it, so a verification by remount passes.
- **The wrong fix a contestant is drawn to.** Searching the roster for "the execution this thread holds": it answers about the reader, not the thread, finds nothing once custody is the operator's, and violates the operator-is-the-control rule.
- **Oracles.** `wire.test.ts` "the pty a harness thread names survives the wire it is parsed by"; `harnessRun.itest.ts` "the run names its pty on the thread and publishes it"; `ThreadTerminal.svelte.test.ts` "a pty named AFTER the page mounted raises the pane, without a remount". The last is bound to the reference API (`open(execution)`) and must be rewritten as behaviour — mount with no address, deliver a frame, expect a pane — before a launch. Add the operator's path end to end through Chrome DevTools: press `+`, pick a harness, expect `.harness-terminal .xterm` within 3 s with no navigation.
- **Judged.** Which of the four causes were found; whether the fix stands at each producer or at the symptom; whether the report's claims match the diff.
