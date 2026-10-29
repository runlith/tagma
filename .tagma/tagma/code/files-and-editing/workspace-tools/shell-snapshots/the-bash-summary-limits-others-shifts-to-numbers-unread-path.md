---
id: 01a12d41-c8c6-785c-a686-0c0fa60f186f
title: The bash summary limits others' shifts to numbers; unread paths stay in the command's observation
ord: 6
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a12d36-21ec-7231-9683-75c20f274db0
sources:
  - kind: file
    ref: packages/agent-tools/src/bash/answers.ts
  - kind: file
    ref: packages/agent-tools/src/bash/managed.ts
---
In a shared checkout a shift inside the command window may be a colleague's edit, so its list must not displace the process's own diagnostics. The short answer carries a summary, while temporarily unreadable paths stay in the managed observation for `read_output` by execution/incarnation: the current `read_changes` will not restore that fact once file availability changes. A local command without managed read-back yields diagnostics before stdout so the list size does not displace the process result.
