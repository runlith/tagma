---
id: 01a168ef-8497-766c-8236-6eecb4fbf255
title: Tool input that does not parse as JSON arrives as a call with `unparsed`, not a stream failure
ord: 39
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a14743-437b-7fd2-9482-3351cc910981
sources:
  - kind: file
    ref: packages/llm/src/llm/protocols/utils/tool-stream.ts
  - kind: symbol
    ref: packages/llm/src/llm/protocols/shared.ts
    symbol: toolInput
---
Every tool input the answer opened ends in a `tool-call` event; text that does not parse as JSON goes in the `unparsed` field with an empty `input`, and the stream does not fail with `invalid-output`. This is how both a call whose provider closed the block and a call left open at the answer end conclude (Anthropic closes it on `message_delta`). An answer cut by the output limit almost always ends in an unfinished call: the old stream failure discarded the whole answer along with finished calls and text, and retrying the request hit the same limit again.

Such a call cannot be executed, and that is the core's call: it answers it with its error. The shared lowering sends such a call with `input: {}`, and the model sees the sent text in the call answer.
