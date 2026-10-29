---
id: 01a12f52-1b26-78b8-bc77-3032870b48f5
title: "Adapter sign-in and settings contract: a set of sign-in methods with paste, separate secret fields, per-model reasoning field at openai-compatible"
ord: 14
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a12c24-69a2-7f74-a6cf-a29052b10a62
---
Gaps from spec-audit №3, №4, №15. Subscriptions declare exactly one `signIn` (loopback | device, `packages/llm/src/oauth/vendor.ts`), no `paste`. The settings schema knows one `key` field: all secret fields in the form share one variable (`InstanceCard.svelte`) and are stored as one console key (`instanceActs.ts`), so the adapter never receives named secrets. For `openai-compatible`, the request field for reasoning is set per instance in one of three variants (`instance.ts`, `settings.ts`), not per model.

Done: a provider declares a set of sign-in methods including `paste`, and the screen shows each; any schema field may be secret, is stored next to credentials under its own name, and is handed to the adapter; an openai-compatible model declares its own reasoning field.
