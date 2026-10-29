---
id: 01a127b3-7def-7581-bb7a-7f4c6337e38c
title: A background command's end notice names shifted files and HEAD like the bash answer
ord: 123
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a12717-89d5-7ba4-bc9f-f63adfa55856
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/collaboration/commandEndings.ts
---
A `bash` answer that waited for a command's end carries what the `ShellRun` measured after it: which files shifted and who their lines are attributed to, whether HEAD shifted, whether the checkout is unmeasured. A command gone to the background gives its total in a `CommandDelivery` notice (`threads/collaboration/commandEndings.ts`), and its text is built on the server from the host's decision, the output tail and the life. No measurement there.

The attribution itself is never lost: `ShellRun.observe` completes in the world lease scope and writes the lines into the change record. Only the story to the agent is lost: it never learns from the notice that the command shifted files or HEAD, and must read `read_changes`.

Why not fixed at once: the measurement ends in the `agent-tools` process later than the host's decision, and the notice may leave earlier. For the delivery to carry the measurement it must wait for it — e.g. `bash` appends the measurement total to `command_delivery.text`, and `CommandDelivery.deliver` waits for that write with a limit. After a restart there is no measurement at all, and the notice must say so instead of staying silent. This changes delivery order and the contract between `agent-tools` and the server.

Done when a background command's end notice names shifted files and HEAD just as the `bash` answer does, or says straight out the measurement is unavailable; a test through public operations.
