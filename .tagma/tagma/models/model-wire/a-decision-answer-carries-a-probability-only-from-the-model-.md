---
id: 01a1645c-2a45-7c77-9040-4bc1f9b48de7
title: "A decision answer carries a probability only from the model that computes it: a text model answers with a verdict and null, and a failure stays a typed refusal"
ord: 36
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/llm/src/llm/decision.ts
  - kind: file
    ref: packages/llm/src/llm/textDecision.ts
---
A decision is a question about text with an answer from a finite set: `state` and named `questions` of type `noul` (yes or no), `choice` (one of the named options), `score` (a level of an ordered scale, 0 the bottom). The shape is the same as the OpenRouter and Inception Decisions APIs: two vendors arrived at it independently, and a decision-model adapter maps onto it with no translation of meaning. The one difference: at a vendor `noul` is itself the probability of "yes", while the contract carries verdict and probability separately so that a text-model answer and a decision-model answer read the same.

Probabilities (`probability`, `probabilities`, `confidence`) come only from the model that computes them. At a decision model a `noul` verdict is "yes" at probability 0.5 or above, and a `score` is its expected position on the scale and may lie between levels; a text model names a level by whole number. A text model answers with a verdict and `null`, not a self-assessment in words: no threshold is set on a self-assessment, and a consumer seeing `null` knows there is no threshold.

`instructions` and `criteria` are a string or JSON, a `choice` option description may be `null`, and a question's `instructions` may be absent: both vendors accept them this way, so a question never needs flattening.

A text model is served by `textDecision.ts` on top of a schema answer (`generateObject` via `ModelRequest.object`): from the questions it builds a JSON schema with one field per question plus the instruction, and it parses the answer itself — the port hands over the tool's raw input, so an unparsed answer becomes a `malformed` refusal in one place rather than at each port in its own way. A `score` level is named by the model as a number string: the Gemini protocol rewrites every `enum` into strings, and a numeric `enum` would come back as a string the parse would reject.

A failure never becomes a verdict: `DecisionRefused` names the reason — `no-model`, `malformed`, `provider-refused`, `input-too-large`. A provider refusal on window overflow arrives as `input-too-large`, as does the input's own pre-call estimate.
