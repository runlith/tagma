---
id: 01a14c13-c481-7acc-8aa6-03c6a28ec4cb
title: The operator's edits in the Tagma editor show as "You" and ride an agent's commit with the file they stand in
ord: 8
tags: ["feature"]
fields:
  {
    "state": "live"
  }
sources:
  - kind: dir
    ref: apps/tagma/server/src/checkout-files/writing
  - kind: file
    ref: apps/tagma/server/src/change-record/contract/wire/holdings.ts
---
**Value.** The operator edits beside agents and sees which lines are theirs; an agent's commit never needs their consent, and what rides along is named instead of hidden.

**How.** Automatic: saves in the editor and tree file operations write through line accounting on the operator's behalf.

**Behaviour.**
- The operator is a holder on par with a thread and always alive: their lines aren't revoked by removed-thread cleanup.
- An autosave series of one path glues into one accounting line and one version above base, not hundreds.
- The Git tab groups "Your changes", diff colors their lines with a separate mark, `read_checkout` and answers to agents name the `operator` holder.
- An agent's `submit_work` carries a file whole, so the operator's uncommitted lines in a carried file ride in the agent's commit, and the receipt's `carried` names `operator` beside it. The operator's other uncommitted files ride too when a carried file holds their recorded lines. The operator carries their own lines away with a commit from the Git tab.

**Limits.** The operator's terminal edits stay nobody's and are named in `unattributed` when they ride. The status bar doesn't split changes into "yours", "nobody's", and "unverified" as the open [[eefb0e60|operator-holder spec]] promises.
