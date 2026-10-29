---
id: 01a110fc-ee3e-7fd1-8fcc-accd4dc050c7
title: Implement the single thread-title path
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a110fd-3265-708b-9109-293a24568438",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a110fc-e0c2-7923-9ec8-1772a6f1d19e
---
Do what the spec describes, on the server and in the app menu. Start with `threads/naming/generate.ts`, `external-harnesses/{settings,titles,observations/admission}.ts`, `runner/claude/session.ts:190`, the provider catalog (`packages/llm/src/models/*`), and `app/.../threads/Menu.svelte`. Done when the spec's itests pass plus the `claude -p` probe.
