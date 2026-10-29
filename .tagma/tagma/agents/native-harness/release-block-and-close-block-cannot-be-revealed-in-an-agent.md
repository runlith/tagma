---
id: 01a16e6e-d660-7bed-a1a5-1f9a8cc0e2ef
title: release_block and close_block cannot be revealed in an agent session that holds the task
ord: 48
tags: ["reflection"]
fields:
  {
    "actual": "Both came back as \"missing\". The release went through `tagma op release_block '{\"blockId\":\"3201be28\"}'` in the shell, and close had to become finish_block with the result written in the body",
    "command": "tool_search query=\"select:mcp__tagma__release_block\" (and select:mcp__tagma__close_block earlier)",
    "expected": "The operation that moves a held #task from in_work back to open (or closes it) becomes callable, as finish_block and claim_block are"
  }
---
Filed from project `runlith`.

The task's status line names release_block and close_block as the operations owning these moves; the orchestrator asked for release_block on 3201be28. Session x-sqlite (thread 01a16dec-fbf8-7898-a8a7-e83233ac9f35).