---
id: 01a0cfcb-0459-7461-ac80-209030a98c3e
title: A graph write that declares only the file it reads is covered by an allow rule naming reads, and so skips the review floor
ord: 172
tags: ["task"]
fields:
  {
    "status": "closed"
  }
---
**What.** `create_block`, `update_block`, `file_delta`, `apply_batch` and `save_agent` write the graph or the agent library. Since they began declaring the caller file they read ([[96f6c2f2]]), that read is the only subject they declare. An explicit allow rule naming only reads, such as `tagma permissions set … --verdict allow --kind read`, now covers them whenever a file is named. An explicit rule is answered before the review floor (`AgentToolDoor.ts#permission`), so under review mode such a write runs without being asked. The same act with an inline body is still asked. The installation had no standing rules when this was written (`tagma permissions --json` answered `rules: []`), so nothing behaves differently yet.

**Why it is open.** The honest fix is for these acts to also declare their graph write. But every `read` and `write` subject also orders the step. A shared value such as `graph:<project>` would make a second graph write in the same step wait for the first. Under review mode it would be declined with a same-batch sentence while the first waits for its reader. Options, each with that cost:
- a graph-write subject the kernel does not order;
- a per-call value;
- kernel support for ordering-only accesses kept apart from permission subjects.

**Done when.** An allow rule naming only reads no longer skips review for a graph write, and several graph writes in one review-mode step are still each asked.