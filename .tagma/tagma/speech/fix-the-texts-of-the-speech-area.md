---
id: 01a14c37-8e1c-7177-858d-edd612db891e
title: Fix the texts of the "Speech" area
ord: 24
tags: ["task"]
fields:
  {
    "status": "closed"
  }
---
- Module card 43059ef8 calls dictation "future", although it shipped.
- The `speech.calls.echo`, `speech.calls.keys`, and `speech.calls.followEvery` settings are not shown in Settings → Speech (`Section.svelte`): show them or explain why not.
