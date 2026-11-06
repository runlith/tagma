---
id: 01a1ae50-527d-778e-bd9b-2dad34b5da4c
title: tool returns NoInfer, so a tool declared without input keeps its no-argument type inside definePlugin
ord: 4
tags: ["explanation"]
sources:
  - kind: symbol
    ref: packages/tagma/src/plugin/plugin.ts
    symbol: tool
---
Inside `definePlugin`, a `tool({...})` call is contextually typed by the definition's `Tool<any>` slot. Without `NoInfer` on its return, TypeScript infers the tool's schema parameter from that context instead of falling back to its `undefined` default. A tool with no `input` would then type its arguments as `unknown` rather than as the empty object its manifest publishes, an object schema with no properties, so the type and what agents are told would disagree. A tool with `input` is unaffected: its schema is inferred from the argument, which outranks the return context. `NoInfer` blocks only the return-type inference, so the declared type and every assignment stay as they were.