---
id: 01a16449-f3a3-7a52-9c4a-904c8105540f
title: "Decisions: the product asks a model typed questions about text and takes a verdict, with probabilities from a model that computes them"
ord: 1
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/naming/excerpt.ts
  - kind: file
    ref: packages/llm/src/llm/call.ts
  - kind: file
    ref: packages/llm/src/models/description.ts
---
The product needs a cheap answer to a question about text — "yes or no", "which option", "how much" — with no chat and no prose parsing. The first consumer is the "addresses a human" event in [[e82af907]]; further candidates, never built before their measurement: "the agent walks in circles", "the turn should go to review", failure classification, a decisions tool for agents themselves.

## Contract

The caller asks in one shape and never knows which model answers:

- **Request.** `state` — text or JSON; `questions` — named independent questions over one state; optional shared `instructions`. Question kinds:
  - `noul` — yes or no, with optional descriptions of what each answer means;
  - `choice` — one of the named options with descriptions;
  - `score` — a level of an ordered scale.
- **Answer** per question: a verdict (`noul` — yes/no, `choice` — option, `score` — value) and probabilities — only from a model that computes them (`noul` — "yes" probability, `choice` and `score` — distribution and `confidence`). A text model has no probabilities — `null`, never its self-assessment in words: no threshold is ever set on a self-assessment. The answer names the model and the road that answered, plus usage.
- **Refusals are typed:** no model available, answer failed schema parsing, provider refused, input larger than the model window. A failure never becomes a verdict.

The shape matches the OpenRouter and Inception Decisions APIs (`state` + `questions`, `noul`/`choice`/`score`): two vendors converged on it independently, and a vendor adapter maps onto it with no change of meaning. `extract` (fragment search, Inception-only) stays out until it has a consumer.

## Where it lives

- **Contract and text-model adapter — the `packages/llm` model layer.** It already has a schema answer: `generateObject` with `schema` or `jsonSchema` (`llm/call.ts`). The adapter builds a schema and instruction from the questions, answers through it, and translates the answer into the contract shape. The decisions core never knows vendors: a decisions-model adapter declares itself and is connected by composition.
- **`decision` capability in the catalog** (today `ModelCapability = 'text' | 'vision'`, `models/description.ts`) marks models that speak the decisions language natively. A text model serves decisions through the adapter without that mark.
- **Model choice — one chain.** Today `threads/naming/excerpt.ts` holds it for titles and manual recap: configured model → the thread provider's light model → a one-off CLI call → the thread's model on the lower rung. The chain becomes shared with the role as parameter — title, recap, decision — each role with its own model setting and rung; no second copy of the choice appears. A one-off CLI answers text with no schema, so that road is skipped for decisions with a cause; a model with `decision` stands first whenever available.
- **Thread decisions are set by `threads`:** it holds the chain and knows the thread's provider, account, and CLI. The role setting sits next to `threads.titleModel`: the decisions model and its rung. Empty — the chain; named — always that one, and an unresolvable name refuses instead of falling to the next road. Decisions outside threads arrive with their first consumer.
- **Every call is an activity entry**, like title and recap: actor, trigger, roads taken and rejected, model, usage, question and answer.

## User

With no keys, decisions run on the light model of the user's subscription. With an OpenRouter key ([[c8e29694]]) the decisions model stands first: faster, cheaper, and with a probability; the setting is the same.

## Performer checks

- Contract test through the public decisions door on a recorded text-model answer: `noul`, `choice`, and `score` arrive in the contract shape, probabilities `null`; an unparsed answer is a typed refusal.
- Choice test: the named model answers, an unresolvable named one refuses, an empty setting takes the provider's light model, with no account of it the thread's model, the CLI is skipped for decisions with a cause. Title and recap take the same road as before.
- A decision leaves an activity entry with road and usage.
- No live model calls in tests.
