---
id: 01a0cacd-ad98-7f74-942b-7f6fbcbc65ec
title: An agent woken by send_message answers into its own thread and the sender is never told
ord: 20
tags: ["reflection"]
fields:
  {
    "actual": "The child woke, worked two model calls and completed its run at 20:24:16 with its whole answer as the run's final text; nothing arrived. The sender sat waiting on an exchange that was already finished, and the operator read it as the agent having answered nobody.",
    "command": "send_message to a spawned child, then wait for its answer",
    "expected": "The child's final text for that exchange reaches the sender, the way a spawned task's report does"
  }
---
Filed from project `runlith`.

Measured today on thread `01a0cab9-6847-7602-bed6-3503d2788ccf`: run `01a0cac5` completed at 20:24:16 with `notification: confirmed`, its answer standing at log position 399 — a full architectural round two, ~11 KB. The parent learned nothing. `list_agents` showed the child `idle`, which reads identically to a child that never had anything to say.

Recovering it took three calls nobody should need: `read_thread` for the run's shape, a `select: entries` query filtered to assistant messages to find the position, then `read_thread_record` to open the text.

The asymmetry is the defect: `spawn_agent` and `send_task` both end in a report delivered to the parent, so a parent conversing with a running child through `send_message` reasonably expects the same and is given silence. Either the answer to a message rides back to its sender, or the message door says out loud that it does not — the sender cannot tell a child still thinking from one that answered into a thread nobody reads.

The cost here was a stalled exchange and an operator asking why his agent had gone quiet, while the answer had been sitting complete for two minutes.