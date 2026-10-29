---
id: 01a11318-a427-7984-844a-a343cfcd2bea
title: "The activity body is bytes its owner encoded once: a tool input is the arguments as the model sent them, a result is the text the model saw"
ord: 24
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/hostedOperations.ts
  - kind: file
    ref: packages/activity/src/fact.ts
  - kind: file
    ref: packages/agent/src/agent/ToolOutput.ts
  - kind: file
    ref: packages/llm/src/llm/schema/responseFold.ts
---
A body has one shape: content type and bytes with a known size. An arbitrary value in `record` would have to be serialized or cloned on the producer fiber, and its size would be known only after that work. The one who already holds the text encodes.

A tool input is the argument text the answer fold assembled. On streaming it is the model's raw JSON; if the provider returned the arguments as a parsed object, the fold encodes them once. For a hosted call, the operation that accepted it encodes the text. A result is the text the model saw after output projection, typed JSON or text. The model's answer is encoded by `ResponseFold.answer`, the request by the transport that sent those bytes. A call with no argument text (for example, one passed through the promise door without it) gets no input body rather than an invented one.
