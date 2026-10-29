---
id: 01a1647b-e478-73c3-a5bd-ece3de3597ba
title: "Decisions API of decision models: one protocol for vendors with this shape, shared instructions go into every question, the OpenRouter path is alpha"
ord: 38
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/adapter-openrouter/src/adapter.ts
  - kind: file
    ref: packages/llm/src/llm/protocols/decisions.ts
---
`protocols/decisions.ts` speaks the Decisions API language (`model`, `state`, `questions` with `noul`/`choice`/`score`, `answers` with probabilities), and a vendor supplies only address and key: so OpenRouter and Inception with one shape need no second protocol. The API has no request-wide instructions, so the decision's shared `instructions` go at the start of each question's instruction — as a string joined by a blank line, or as an array when the question instruction is JSON. An answer of a different type than the question, or a `choice` variant outside its criteria, is a `malformed` refusal, not a verdict.

OpenRouter answers on `POST /api/alpha/decisions`, outside the `/api/v1` prefix of its catalog (verified against the docs on 2026-10-22); the vendor may rename the path with the word `alpha`, and then only the address in the adapter changes. The decision-model catalog (`GET /api/v1/models?output_modalities=decisions`) is read with the operator key: without a key there are no models, and the decision chain takes the old roads. The provider is declared `textless`: the thread's default model never picks it, and picking a text model never prompts sign-in for its catalog — it would have no text models even with a key.
