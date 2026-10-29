---
id: 01a1646b-02cd-7e33-8e14-5385c4f595c3
title: A schema-bound answer asks the model for the strongest tool mode it declares, and a provider content-policy refusal stays a refusal, not an unparsed answer
ord: 37
tags: ["explanation"]
sources:
  - kind: symbol
    ref: packages/llm/src/llm/call.ts
    symbol: generateObject
---
`generateObject` answers through a single tool and picks the mode by the model's `compatibility.toolChoice`: a named tool when declared or when the list is unset, otherwise `required`, otherwise `auto`. Models declaring only `auto` and `none` (Sonnet and Opus at Anthropic and Muse models are declared this way, for example) would otherwise refuse back in `LLM.compile`, before HTTP, and a schema-bound answer on them would be impossible at all. Under `auto` the model may not call the tool — that stays an `InvalidProviderOutput` refusal, as before.

A `content-filter` answer end becomes `ContentPolicy` before the tool-call search: without this, a provider holding back its answer under its own policy would read as a model answering off-schema, and the caller could not tell a provider refusal from a bad answer.
