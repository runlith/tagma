---
id: 01a13f63-559c-7cb3-89b6-c44818dd0fe5
title: "Execution reflections: bash and the execution host lose the outcome, the output or the obligation"
ord: 22
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13f64-c076-7697-a126-c8ea82d299c8",
    "status": "done"
  }
---
Fix at the root the explicit defects from the reflections:
- [[44202c0b]]: a finished command prints a background-carry refusal with owes nothing.
- [[2618aff7]]: bash after waitMs held a command over a vanished obligation.
- [[1f914bf1]]: `echo` answered with an undecided host outcome.
- [[298f933b]]: the runtime reports that an accepted bash never launched, while the execution ends.
- [[4407d0f9]]: read_output answers with effect-unknown after the command ends.
- [[f5bacc7b]]: a child agent's bash loses a large git diff, the host stops sending state.
- [[c9c42c8c]] and [[b85b0723]]: grep won't deliver a bounded page when held stdout overflows.
- [[ccd82433]]: bash refuses no-approver on git init/commit in a temporary repository outside every checkout.
- [[60a50d7a]]: an agent turn in a shared checkout fails world-unavailable: RootConflict, the next continue_agent passes.

Outcome:
- fixed and answered: 44202c0b, 2618aff7 (f188f71cbf); c9c42c8c, b85b0723 (782a51c816, test hardened in 242d92895b); takes effect after the operator restarts the server.
- 1f914bf1, f5bacc7b: a command is accepted and queued, its work starts at build and may write `ended` into the store before Live is held; the State subscription in this window closed `completed` with no state. Fixed in a9e5463e29 and e9eecb2c51 (stest `acceptedState`, without the fix 2 losses in 100); the server answers an exit with no decision as Undecided (ebe2ade993).
- 298f933b: the notification names the id of the broken call (2f41fb4de9).
- 4407d0f9: launching a call records whether its tool changes anything; a read left open at turn end, process death, stop or restart ends `cancelled`, not "effect unknown" (3e2698f277, e9eecb2c51).
- ccd82433: "Commits into" asks only about a registered checkout (6262131c2c).
- 60a50d7a: cause — someone else's root registration whose directory was recreated (tagma-proof/head at 04:01Z): the footprint permission check failed `replaced` once. Now it passes through (8ed10215ea, e9eecb2c51); the world refusal names the cause.

First check whether each reproduces on current code. An item whose fix needs a product decision is not done but named in the report. Proof — a test against the contract where one exists, and a grounded commit; fixed reflections are answered through answer_reflection.
