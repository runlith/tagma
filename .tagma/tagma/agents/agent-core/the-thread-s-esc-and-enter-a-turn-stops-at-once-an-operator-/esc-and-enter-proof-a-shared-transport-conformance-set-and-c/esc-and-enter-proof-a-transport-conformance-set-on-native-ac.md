---
id: 01a15fab-5a84-7166-9c8e-59d59ab6756b
title: "Esc and Enter proof: a transport conformance set on native, ACP, and terminal plus Claude Code 2.1.306 interruption measurements"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15fa9-e310-793a-ad96-beecfa95d169",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a15eeb-6b48-7ca8-9c93-24db7deebf81
---
Claude Code interruption measurements in states missing from [[980edf66]] — #research under the external-CLI module. The "Esc and Enter" transport conformance set in `packages/agent/src/thread/conformance`, runs for native, ACP (scripted agent and Claude runner on a fake `Channel`), and terminal (fake CLI in a PTY); implementation-test doubles leave. The Enter part — after the operator-words commit ([[026af37c]]).
