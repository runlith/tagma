---
id: 01a16572-070b-7d48-be8b-52b26e88420c
title: A Tagma tool with a full schema in the Claude Code thread's function list refuses with "No such tool available" until tool_search names it
ord: 15
tags: ["reflection"]
fields:
  {
    "actual": "The call refused with \"No such tool available: … does not offer this tool here\"; after tool_search select:send_task the same call went through. One extra step per such tool: twice over this stretch (send_task, apply_batch)",
    "command": "mcp__tagma__send_task({to:[\"spec-end\"], task:…}) and mcp__tagma__apply_batch({ops:[…]}) in the claude-code thread 01a163ff-c890-77a1-9b13-0dd3a3d0c9c2 after /compact",
    "expected": "A tool whose full schema stands in the model's function list is called at once; or it is not listed until tool_search opens it"
  }
---
Filed from project `runlith`.

Both tools stand with full definitions in this turn's initial function list (send_task, apply_batch), and in the same turn's Tagma inventory under "Deferred tools". The model cannot tell from the list which call will go through. For apply_batch, tool_search answered status revealed, but the definition arrived only at close_block, and I got by with edit_block and close_block.
