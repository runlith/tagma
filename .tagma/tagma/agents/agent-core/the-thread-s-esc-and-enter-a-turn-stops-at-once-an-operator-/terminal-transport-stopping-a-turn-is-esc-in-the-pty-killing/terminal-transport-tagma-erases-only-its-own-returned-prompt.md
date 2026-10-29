---
id: 01a15f9a-184b-7edc-a812-4347a58eaa43
title: "Terminal transport: Tagma erases only its own returned prompt from the composer, another's text holds the word; Codex, Devin, Grok composer readers; Grok 1.0.62 hooks; ends.interruptStop"
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15f39-1d19-7756-a1b0-1ee4e73e2530",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a15eeb-6b48-7ca8-9c93-24d8d0f5ca7e
---
Invariant: an operator word reaches the agent exactly once and whole; the operator's text is never lost from the TUI. Clearing after an interruption erases only what matches what Tagma printed in that turn; other text in the composer holds the next word, with the cause in the thread snapshot (the "words await" channel from 026af37c). Composer readers for Codex, Devin, Grok from probes 7e38ec20, 4776e930, d3668d90. Find out why the Grok 1.0.62 hooks did not fire and whether it breaks the turn start and end. Remove or wire up `ends.interruptStop`.
