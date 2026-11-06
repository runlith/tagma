---
id: 01a1b2f1-6644-7b8c-ad1e-15cff2b5f5d1
title: Keep a message a beforeStep hook blocks from the model, durably
ord: 7
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1b15d-07d5-7762-ad3c-66b601e63162",
    "status": "in_work"
  }
edges:
  - kind: discovered-from
    to: 01a1b2c8-4ce0-7617-9163-191176747387
  - kind: implements
    to: 01a1ad4a-de84-7ddc-9396-cf6ac4451a7e
---
A `beforeStep` hook that blocks — Tagma's `block` answer, `onFailure: 'block'`, or a Claude Code or Codex `UserPromptSubmit` that answers `decision: "block"` or exits 2 — only adds its reason as a guide: the plugin-hooks rule (`native-harness/turns/pluginHooks.ts`) turns `block` into `{type: 'guide'}`, and the message still reaches the model in this step and every later one. The `block` field's description says the message stays in the thread but does not reach the agent, which reads the reason in its place; Claude Code's own `UserPromptSubmit` block erases the prompt from context.

The agent core has no way to do it: no `AgentDirective` removes a reader input (`packages/agent/src/agent/policy/AgentRuntimePolicy.ts`), `planStep` (`agent/turn/plan.ts`) sends `[...projected, ...signals, ...guides]`, and no per-entry mark excludes a message from the projection. A step-local filter is not enough: the next step and the next run project the history again.

Done when a blocked message is kept from the model in this step and every later step and run — the reason standing in its place — while the thread still shows it as withheld; the rule answers a withholding directive for the inputs it judged, for every format; the `block` description states exactly that; a test through the same door the real caller uses (a hook blocking a message in a native run) fails before the fix.
