---
id: 01a19581-a3c9-7aff-ad9a-5218e1c2a2a3
title: Blocking child question ends without an answer when its run ends
ord: 1226
tags: ["reflection"]
fields:
  {
    "actual": "Returned only \"The tool call did not finish: the run that made it ended first\"; no chosen values or pending-question reference was returned.",
    "command": "ask_user({title:\"Frozen DOM contract choices\",questions:[{header:\"Input ordering\",prompt:\"Choose the #16168 handler/effect contract\",options:[\"handler-before-effect\",\"effect-before-handler\",\"keep-unresolved\"]},{header:\"Crossfade blending\",prompt:\"Choose the #6668 disposition\",options:[\"exclude-unspecified-compositing\",\"keep-selected-blocked\",\"require-general-blending\"]}]})",
    "expected": "Deliver the two related contract choices to the parent and return its answer, or retain a resumable pending question when the child's run ends."
  }
---
Filed from project `vigla`. Received by a server up since 2026-11-01T04:35:00.962Z, from b555dcaa0.

This happened while a scoped harness command ended in the background. The next notice opened the child again with the test result; I relayed the still-unanswered choices to the parent by send_message rather than assuming approval.