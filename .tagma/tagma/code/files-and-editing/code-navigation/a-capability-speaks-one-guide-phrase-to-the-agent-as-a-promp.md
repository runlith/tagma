---
id: 01a16bd1-914a-72f4-9e3a-60d9a3d78531
title: "A capability speaks one `guide` phrase to the agent: as a prompt line at birth, in the enable notice, and once per thread after a call matching its cue"
ord: 3
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/capabilities/cueRule.ts
  - kind: file
    ref: apps/tagma/server/src/navigation/contract/wire/capability.ts
  - kind: file
    ref: apps/tagma/server/src/navigation/doctrine/codeNavigation.ts
---
A capability speaks one `guide` phrase to the agent three ways: as a prompt line at the birth of a thread born with the capability on, in the enable notice, and once per thread after a call matching its cue.

A line in the system prompt is not always followed by the model: Muse skipped it, but reacts to a hint beside a tool result and to a word in the task. So `guide` is declared once per capability and arrives three ways: as a prompt section for a thread born with the capability on; in the enable notice for a thread whose prompt froze earlier; after the first call of the `cue.tool` whose `cue.input` matched `cue.matches`. A switched-off capability's section never reaches the prompt — otherwise a thread with navigation off would be told to call a tool it does not have.

Once-per-thread holds on delivered-hint state in the thread's messages. A mark computed at evaluation would lose the hint: the rule also evaluates for background calls, while only the foreground call gets the hint. After compaction the hint may come again. The navigation template catches `\.name\(` and `\.(a|b)`. A search extension like `\.(ts|tsx)` fits it too and yields one extra hint per thread.
