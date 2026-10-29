---
id: 01a13264-ec72-7709-8cb8-15fe069b6f38
title: "Vendor web for OpenAI-subscription threads: native openai-oauth searches and reads via Codex web.run, approval like Tagma tools"
ord: 10
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/capabilities/web.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/tools/vendorWeb.ts
  - kind: file
    ref: packages/adapter-openai/src/profiles/openai.ts
  - kind: file
    ref: packages/llm/src/llm/protocols/openai/lower.ts
  - kind: file
    ref: packages/llm/src/llm/protocols/openai/stream.ts
  - kind: file
    ref: packages/llm/src/profiles/vendorWeb.ts
---
## What the operator gets

A thread on an OpenAI subscription (`openai-oauth`) searches and reads the web like Codex: through `web.run` and the ChatGPT search endpoint, not through the free MCP Parallel and Exa. This covers the models Codex itself gives `web.run` to — all gpt-6-* and gpt-5.6-*. gpt-5.5 and the console `openai` stay on Tagma tools: for gpt-5.5 Codex sends the server-side `web_search`, which cannot be asked per call, the model is outdated, and a second web kind is not built for it.

Operator-visible behavior matches other providers:
- the same setting — `agent.web` (`vendor` by default, `tagma` returns Parallel and Exa);
- in journal and feed the call is named `websearch`, its subjects are queries and addresses;
- approval matches Tagma tools:
  - search never asks in any mode;
  - a call that opens or reads pages asks in review, like `webfetch`;
  - trust and bypass ask nothing.

## What Codex does

Read `.external/codex`, commit `09bced5ad` (2026-10-02).

**Shape choice** (`core/src/tools/spec_plan.rs`). On models with `use_responses_lite` no server-side Responses tools are sent at all, and `web.run` is on with no flag (`standalone_web_search_enabled`). In the `models-manager/models.json` catalog that is all gpt-6-* and gpt-5.6-*; gpt-5.5 has no lite, and it gets the server-side `web_search`.

**Declaration** (`ext/web-search/src/tool.rs`). A `web` namespace with one function `run`, `strict: false`, parallel calls allowed. Description is `ext/web-search/web_run_description.md`. Schema is `SearchCommands` (`codex-api/src/search.rs`), generated with no description compression. Commands split into groups:
- search: `search_query`, `image_query`;
- page reading: `open`, `click`, `find`, `screenshot`;
- reference: `finance`, `weather`, `sports`, `time`;
- `response_length`.

**Execution.** `POST {base}/alpha/search`, for subscriptions `https://chatgpt.com/backend-api/codex/alpha/search`. Authorization matches the main request, plus `originator` and `x-codex-turn-metadata` headers.

Body:
- `id` — the session id;
- `model` — the turn model;
- `input` — the conversation tail (`ext/web-search/src/history.rs`): the previous and current user messages, text only and with no context insertions, plus up to 1000 tokens of assistant text between them;
- `commands` — the call arguments;
- `settings`: `allowed_callers: ["direct"]` and `external_web_access` (`true` in live mode, `false` in cached mode);
- `max_output_tokens` — the tool-output truncation budget.

The answer is `{output, encrypted_output, results}`. Only `output` goes into `function_call_output` as text. The answer carries no usage.

Codex's default mode is cached; live is for full access. A native Tagma thread works with full access to its world, so live is used.

**Capture** (codex-cli 0.162.0, gpt-5.6-sol, `records/codex/web.*` and `webdirect.*`) refined the reading:
- `/models` answers `use_responses_lite` and `tool_mode`. Lite and `tool_mode: code_mode_only` hold for all gpt-6-*, gpt-5.6-*, plus `gpt-reserve` and `codex-auto-review`; gpt-5.5 has neither.
- **Code mode.** Under `code_mode_only` Codex does not emit `web.run` on the wire as a separate tool: it is nested inside `exec` (the TypeScript declaration in the `exec` description), and the model calls `tools.web__run({...})` via a `custom_tool_call` script. The `web` scenario recorded exactly that.
- **Direct shape.** The `webdirect` scenario is the same Codex with a model catalog with `tool_mode` removed. It recorded the declaration `{type: "namespace", name: "web", description: "Tools in the web namespace.", tools: [{type: "function", name: "run", strict: false, description, parameters}]}` as an `additional_tools` element in `input`. In the stream: a `function_call` with `namespace: "web"`, `name: "run"`, `call_id`, and `arguments`, with arguments arriving as `response.function_call_arguments.delta` deltas.
- **Search.** Headers: authorization, `chatgpt-account-id`, `originator`, `user-agent`, `version`, and `x-codex-turn-metadata` (JSON with session, turn, and sandbox ids); no `session-id`. The body is as above, with the tail messages also carrying Codex-internal metadata (`internal_chat_message_metadata_passthrough`). `max_output_tokens` is 10000. The answer is `{output, encrypted_output, results}`, with no quota headers.
- The model can combine search and page opening in one call (`search_query` together with `open`).

Capture did not establish whether the server accepts a namespace tool in the `tools` field on a lite model: that is how `openai-oauth` sends, while Codex puts it into `input`. The operator's live run checks that.

## Architecture

The core knows no vendors (rule 6f758080). The vendor-web contract introduced by the Claude spec generalizes: a vendor declares its own tool set, not a mandatory pair. It is one contract shape, and Claude moves onto it in the same change.

### 1. Contract (`packages/llm/src/profiles/vendorWeb.ts`)

`VendorWeb` is a record by Tagma tool name: `{ websearch?: VendorWebTool; webfetch?: VendorWebTool }`, at least one key. Two vendor tools onto one name are inexpressible by construction.

Each `VendorWebTool` declares:
- wire;
- input schema;
- executor;
- `reads(input): boolean` — whether the call opens pages;
- `targets(input)` — the queries and page addresses the call names.

Web memory (pages, domains, `lifetimes`) is declared only by a vendor that needs it. The call type gives `memory` only to a tool whose vendor declared `lifetimes`, so a tool that needs memory cannot be declared without it. Claude declares search (`reads` always "no"), reading (always "yes"), and memory. OpenAI declares only `websearch` with no memory.

### 2. Approval (`native-harness/tools/vendorWeb.ts`)

The call's subjects make Tagma tools from its `targets`: queries become `websearch`, addresses `webfetch`, so a `web.run` call, whose input looks nothing like `websearch` input, shows the same queries and addresses in the journal. Approval is the same for every vendor tool: the call itself never asks, and one "reads pages" condition asks. Its level and timeout come from the Tagma `webfetch` declaration, not written twice. `prepare` raises that condition (`raised`) when `reads` answers "yes". So review asks exactly where it would ask for `webfetch`, trust and bypass pass, and Claude reading, whose `reads` is always "yes", keeps one question instead of two reasons at once.

`reads` for `web.run` is closed by default:
- only a call holding nothing but search and reference commands answers "no";
- `open`, `click`, `find`, `screenshot`, or any key the shape schema does not name is "yes".

A new Codex command therefore asks in review until it is parsed.

### 3. Catalog (`native-harness/capabilities/web.ts`)

Vendor tools take the places of same-named Tagma tools. A Tagma tool the vendor did not declare leaves the catalog under vendor web. For OpenAI `webfetch` leaves: Codex sends no separate reading, pages are read through `open`, and local addresses through shell.

### 4. Model-based decision (`native-harness/turns/runWebs.ts`)

Today `RunWebs` holds the decision by `runId`. A mid-run model change (`set_agent_model` moves a child to another model from the next step) would leave the old vendor's tools on the new wire. So the decision is held together with the provider and model it was taken for. A step on another model decides anew, while an `agent.web` change still takes effect from the next run.

### 5. History and wire (`packages/llm`)

- **Declaration field.** `ToolDefinition.vendorWireName` is replaced with one structural field `vendorWire: { name, namespace? }`, where namespace is its name and description as Codex emits them in the declaration. `ClaudeCodeTools` reads it (as now), and OpenAI Responses lowering; the old field is removed in the same change.
- **OpenAI Responses lowering.** `openai-oauth` runs no code mode and sends tools in the `tools` field, so `web.run` is emitted there in the direct shape recorded by `webdirect`: a `web` namespace with a `run` function. A history call repeats as a `function_call` with `namespace`.
- **Stream parsing.** A `function_call` with a namespace is translated to the Tagma name by the reverse map from that same request's tools. The protocol keeps no name list. A call the request did not declare travels the usual unknown-tool road.
- **History.** In history the call is stored under the Tagma name (`websearch`). On repeat, lowering returns it the vendor wire only when the current request declares that tool. Otherwise — after switching to `tagma`, another model, or another provider — the call repeats under the Tagma name, and its result stays in history. So one thread survives a web-source change between turns.

### 6. The `web.run` executor (`packages/adapter-openai/src/profiles/`)

The `openai-oauth` profile gives `web` only to a model whose generated fingerprint holds the `web.run` shape. The extractor writes the fingerprint:
- the shape — the declaration from the `webdirect` run, the search path relative to the main request, `settings` and `max_output_tokens` from its search request;
- the model set — models with `use_responses_lite` in that run's `/models` answer.

Codex's `version` and `x-codex-turn-metadata` headers and message-internal metadata are not carried over: `openai-oauth` presents itself in the main turn too, and search carries the same `chatgptIdentity` identity.

A Codex update is a capture rewrite and a `regenerate`, not a code edit. Neither an id list in code nor a model capability repeats it.

The executor:
- **Input.** Checked against the shape schema; input the schema rejects is a call refusal, not a request.
- **Conversation tail.** Built by the Codex rule from the thread messages. The call receives them from the agent through `VendorWebCall`, where the agent passes `ToolCallArrival.messages`. Tagma system insertions have the `system` role and do not enter the tail.
- **Request.** Goes through the `HttpExecutor` of the same route as the main turn:
  - `chatgptIdentity` authorization;
  - token recovery and retry on 401 through `credentialRecovery`;
  - byte recording by the transport;
  - cancellation together with the call.

  There is no separate fetch past the route. The search answer carries no quota headers, and it reads no quota.
- **`max_output_tokens`.** The fingerprint value is the tool-output budget Codex sends.
- **Answer.** The `output` text; `results` unused.
- **Failure.** HTTP failure, an undecodable answer, or an empty `output` is `WebRefused` with the vendor text, with no Tagma fallback (rule ea465bed). The "sign in again" hint is only for an authorization refusal.
- **Accounting.** The endpoint returns no usage, so search is no `model-call` and does not enter run tokens. The exchange stays in the transport record under the call activity.

## Order

1. **Contract and harness.** Generalized `VendorWeb`, Claude moved onto it with no request changes, the "reads pages" condition, the catalog by declared names, the model-based `RunWebs` decision.
2. **Wire.** `vendorWire` instead of `vendorWireName`, namespace in OpenAI Responses lowering and stream parsing, history repeat by request declarations.
3. **Profile.** Extractor and generated fingerprint, the `web.run` executor on `openai-oauth`.

## Acceptance criteria

The performer proves:
- owner contract tests:
  - `openai-oauth` on a model with the shape and `agent.web = vendor`: the catalog holds the vendor `websearch` and no `webfetch`; on the wire, the shape's declaration; a call sends the search request and answers its `output`;
  - gpt-5.5, console `openai`, or `agent.web = tagma`: Tagma tools;
  - review: a call with only `search_query` does not ask; a call with `open` or an unknown command asks; trust asks neither;
  - an endpoint failure is a call refusal with the vendor text; 401 recovers the token and repeats the request;
  - a history with a `web.run` call repeats into a request without that tool (after `agent.web = tagma` and on another provider);
  - a mid-run model change from gpt-5.6 to a model without the shape removes `web.run` from the next step;
  - Claude after the contract generalization makes the same requests: `web` replay gate with no diffs;
- typecheck and the tests of `packages/llm`, `packages/agent`, `packages/adapter-openai`, `apps/tagma/server`;
- note [[cccbfb07]] rewritten in the same change: vendor web is a record of tools by Tagma names, approval by `reads`, decision by model.

The operator verifies: a live native thread on gpt-5.6-sol searches and opens a page; in review the page opening asks; switching `agent.web` to `tagma` returns Parallel and Exa.
