---
id: 01a14c13-c481-7acc-8aa6-03c6a28ec4cb
title: "The operator's edits in the Tagma editor are their lines: they show as \"You\", don't ride into an agent's commit, and leave with their own commit"
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
**Value.** The operator edits beside agents without fearing their unfinished edit will ride into someone else's commit or become "nobody's".

**How.** Automatic: saves in the editor and tree file operations write through line accounting on the operator's behalf.

**Behaviour.**
- The operator is a holder on par with a thread and always alive: their lines aren't revoked by removed-thread cleanup.
- An autosave series of one path glues into one accounting line and one version above base, not hundreds.
- The Git tab groups "Your changes", diff colors their lines with a separate mark, `read_checkout` and answers to agents name the `operator` holder.
- An agent's landing in a region with the operator's lines refuses with their name; the agent lands them only with the operator's `taking` on the operator's word. The operator carries their own lines away with a commit from the Git tab.

**Limits.** The operator's terminal edits stay nobody's. The status bar doesn't split changes into "yours", "nobody's", and "unverified" as the open [[eefb0e60|operator-holder spec]] promises.
