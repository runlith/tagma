---
id: 01a1176d-5614-780d-97df-eca8be69f3ea
title: "CLI through the terminal: shell and foreign-CLI search bring rule delivery through shellShown (part 3 of spec 00c25ecb)"
ord: 2
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: implements
    to: 01a1175a-4c4e-7702-badc-614a00c25ecb
---
Done: `6dc2a6149b`, `e2be9076a9`, `78f9c0e230` — printedOf → shellShown → batched delivery and today's guidance delivery; [[5565be05|workspace tools]] open the needed entry, search is expressed as `ToolShown.as: found`.

Remainder of part 3 of the [[00c25ecb|shown-files spec]]: prove Claude's PostToolUse Bash through the terminal up to the actual delivery, and check the Codex, Devin, Cursor, and Grok events against their adapters. Start with `external-harnesses/hooks/dispatch.ts:335–395`, `adapter/claudeFormat.ts:44–52`, and `composition/testing/cli/hookLaw.itest.ts`. Today five adapters share one `claudePrinted` taking Bash/Grep names and Claude fields; field extraction and Read/Edit tests do not prove the shell boundary of the other CLIs. That is unproven coverage, not a reproduced failure of all CLIs.

Proof of completion: real-form events of each claimed CLI through the public hook deliver the law — for found, a pointer to the explanation; on read, its body; Claude's Bash covered by an end-to-end test; server/agent-tools typecheck clean. In the revision the typecheck and shellShown/Bash tests passed; the end-to-end dispatch link is unproven.
