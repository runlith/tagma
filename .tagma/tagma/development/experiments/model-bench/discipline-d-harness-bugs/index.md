---
id: 01a0c4f7-9213-7775-ab6f-372de25a3a61
title: "Discipline D: harness bugs"
ord: 1
---
Discipline D is three bug hunts taken from the harness-terminal session of 2026-09-12, each a bug the shipping session took several rounds to find, and each pinned to the commit it was hunted from.

- **What they share, and why they measure something.** One symptom, several independent causes in several layers, and NOT ONE of the causes raised an error, a log line or a failing test: a schema that dropped a field on decode, a frame nobody published, a prop read once at birth, a run that ignored its own abort. Every layer was right by its own test; only the operator's path failed. A contestant that verifies by a road other than the operator's declares victory on a partial fix — that false victory is the measured failure mode, beside the fix itself.
- **The three.** [[7a3ab368]] — a terminal that appears only after leaving and returning, four causes across wire, server, custody and client. [[b9c44709]] — a Delete that stays grey for ever, five causes across the page, the resource plane, the kernel and the run. [[d689ef45]] — a CLI started on Tagma's own plumbing text instead of the operator's words, one file, one wrong predicate, and a first fix that broke a neighbour.
- **Against the other disciplines.** A ([[4ac015f4]]) measures naming a shape; C ([[79ff4b56]]) measures a historical root-cause hunt with a withheld repair and two assigned fixes. D is C's shape — symptom-led, repair withheld, judged on mechanism and producer — applied to bugs whose difficulty is DEPTH ACROSS LAYERS rather than age: every D start commit is from one day, the reference repairs are in the same history, so the leakage rule of [[c12b7eb7]] binds D exactly as it binds C, and the runtime of [[e9706241]] is its admission.
- **Against the delegation bench** (`c4b5d4c5`): D fixes the agent to one and varies the model; that bench fixes the task and varies the delegation pattern. A D bug is a fit task for it too — the seed case's virtue, a silent lie across package floors, is what every D bug is.
- **Oracles.** Each hunt names the hidden tests its reference repair landed and where an oracle is still missing; a missing oracle is written before a launch, never inferred from the reference diff at judging time.
