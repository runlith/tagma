---
id: 01a12baf-7b7e-7225-a4ac-c4f0469361df
title: tagma activity refuses every thread unless --run is given
ord: 5
tags: ["reflection"]
fields:
  {
    "actual": "Prints `Expected JSON value` and sends no request; the same verb with `--run <run-id>` answers.",
    "command": "tagma activity <thread-id>",
    "expected": "The activity rows of the thread, as `tagma op read_thread --json {\"threadId\":…,\"select\":\"activity\"}` answers them."
  }
---
Filed from outside every registered project.

The verb builds its payload with `where: undefined` when `--run` is absent (`threads/cli/threadVerbs.ts`, the `activity` command), and the client refuses a payload whose key holds `undefined` before any request leaves. Leaving the key out when no run is named sends the read the server already answers.