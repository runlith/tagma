---
id: 01a14bae-6720-7d62-897a-928f4a7de7db
title: "Terminal CLI thread profile: its own vendor settings directory, bare CLI with no Tagma inside, its own permission mode"
ord: 7
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-927ef2dc414b
  - kind: supersedes
    to: 01a14b6d-b256-741e-ac32-e411b5a5f27c
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/approvers.ts
  - kind: symbol
    ref: apps/tagma/server/src/external-harnesses/birth/profile.ts
    symbol: profileOf
  - kind: symbol
    ref: apps/tagma/server/src/external-harnesses/birth/seat.ts
    symbol: birthSeat
  - kind: symbol
    ref: apps/tagma/server/src/external-harnesses/settings.ts
    symbol: harnessProfile
---
**Value.** The operator launches a CLI the way they are used to without Tagma — with their own settings directory and account, with their own permission mode, or entirely bare — and still sees it as a thread.

**How.** The `threads.harnessProfile` setting, per vendor.

**Behaviour.** A thread keeps its birth profile for life. Its own settings directory replaces the logged-in account. A bare CLI gets no hooks, skill, MCP, or Tagma powers and sees the assignment as its sender wrote it; Tagma still shows the terminal, delivers words, and learns the turn's end from the vendor transcript, and the run's last message becomes the answer to the parent. The CLI's own permission mode turns its permission screens into questions to the thread's parent.

**Limits.** Terminal transport only. A bare CLI needs its own settings directory; a CLI that has not completed its first launch in that directory is not born, and the refusal names the setup command. Not all vendors support a separate settings directory and bare mode.
