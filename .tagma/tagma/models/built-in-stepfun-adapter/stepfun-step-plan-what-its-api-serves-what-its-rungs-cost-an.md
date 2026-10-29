---
id: 01a0c701-0dcd-7068-93cc-29bc7f888115
title: "StepFun Step Plan: what its API serves, what its rungs cost, and what it will not tell a client"
ord: 1
tags: ["research"]
fields:
  {
    "source": {
      "name": "StepFun Step Plan API and platform documentation",
      "ref": "https://api.stepfun.ai/step_plan/v1 + https://platform.stepfun.ai/docs, live probes on a Flash Plus subscription, 2026-09-22"
    }
  }
---
Read to wire StepFun into this monorepo as a console-key provider. Two sources: the vendor's own documentation, and live calls against a paid Flash Plus subscription on 2026-09-22 — every number below marked *measured* came off that account, and the rest is the vendor's word.

## The plan path is a purse of its own

Step Plan is a monthly credit allowance reached at `https://api.stepfun.ai/step_plan/v1`; the vendor's pay-as-you-go API at `https://api.stepfun.ai/v1` bills an account balance instead. Both accept the same console key as `Authorization: Bearer`, and both answer — so a call sent to the wrong base URL succeeds while spending the wrong money, and nothing in the reply says which purse paid. Measured: `/v1/accounts` reported `balance 0.00` on this subscription while plan calls went through, which is the two purses in one reading.

The plan serves two wires: chat completions at `/step_plan/v1/chat/completions` and Anthropic messages at `/step_plan/v1/messages`. An effort word rides `reasoning_effort` on the first and `output_config.effort` on the second. Claude Code is configured against `https://api.stepfun.ai/step_plan` without the `/v1`, because that client appends `/v1/messages` itself.

## What the deployment publishes about itself

`GET /step_plan/v1/models` answers per-row metadata, which is the best source for a catalog row — measured, 2026-09-22:

| id | `max_input_tokens` | vision | `reasoning_effort_support_list` | protocols |
| --- | --- | --- | --- | --- |
| `step-5-preview` | 1 024 000 | yes | low, high, medium | chat, messages, responses |
| `step-3.7-flash` | 262 144 | yes | low, high, medium | chat, messages, responses |
| `step-3.5-flash-2603` | 262 144 | no | low, medium, high | chat, messages |
| `step-3.5-flash` | 262 144 | no | *absent* | chat, messages |

The vendor's model page for `step-3.5-flash-2603` names `low` and `high` alone and describes the low word as a cheaper inference mode, so the endpoint's three-rung list and the documentation disagree for that row.

Output ceilings: the vendor publishes one for `step-5-preview` (64k of its 1M window) and none for the Flash rows. Measured: `max_tokens: 999999999` was accepted without refusal on every row, so nothing upstream bounds output — a caller's own reservation is the only limit.

The same answer carried `stepaudio-2.5-tts`, `stepaudio-2.5-asr` and `step-image-edit-2`. The image row retires 2026-10-10 by the vendor's notice, together with the text-to-image, image-to-image and editing endpoints on both channels. `step-router-v1`, documented as a plan-only router between `step-3.7-flash` and a DeepSeek engine, answered 404 `model_invalid` on this subscription.

## What a rung costs, and where the rung does nothing

Measured on one identical prompt, one sample per rung, counting completion tokens (thinking is billed inside them):

- `step-3.7-flash`: 409 at low, 911 at medium, 3523 at high. The ladder is real and its top rung is an 8.6x bill.
- `step-3.5-flash-2603`: 3192 / 2969 / 3046, and a repeat run gave 2569 at low against 2981 at high. Four samples, no order.
- `step-5-preview`: 1112 at low, 509 at medium, 1329 at high. No order.
- `step-3.5-flash`: publishes no ladder and thinks on every call regardless.

So only `step-3.7-flash` was observed to obey the word. For the other rows the evidence establishes nothing: single samples cannot separate a rung from sampling variance, and the experiment was not repeated enough to try.

An effort the endpoint does not know is **ignored, not refused**: `reasoning_effort: "banana"` answered 200 on every row, with a thinking length between the medium and high readings. Nothing about these ladders can be settled by provoking a refusal, which is how the ladders of the OpenCode Go deployment were established.

## Wire shapes a reader must survive

- **Tool-call continuation deltas spell identity as empty strings.** Measured on `step-5-preview`: the first delta carries `id`, `type` and `function.name`, and every later delta of the same call carries `id: ""`, `type: ""`, `function.name: ""` instead of omitting them. OpenAI's own wire omits them. A reader that treats an empty string as a present-but-empty identity fails the whole stream, which is what this monorepo's OpenAI-Chat reader did until it was taught to read an empty identity as absent.
- **Thinking arrives twice.** Every row returns `reasoning` and `reasoning_content` with identical text, on the streamed delta and the whole message alike, with no `reasoning_format` asked for.
- **`usage` is nested**: `prompt_tokens_details.cached_tokens` and `completion_tokens_details.reasoning_tokens`. The reasoning count reported 0 on every call measured, including calls whose reasoning text ran to thousands of characters, so thinking is counted inside `completion_tokens` and that field cannot be trusted as a thinking measure.
- **A replayed assistant turn needs no reasoning echo.** Measured: a message carrying `tool_calls` and no `reasoning_content` was accepted, unlike DeepSeek's own API. Sending an empty echo was also accepted, but the reply then repeated the answer as its thinking.
- **`tool_choice` is not read.** Measured on `step-3.7-flash` and `step-3.5-flash`: `"required"` and a named function both answered plain text with no call. Forcing a tool is therefore unavailable, whatever the model pages say about `tool_choice` orchestration.
- **An unknown request field is ignored**, not refused (`banana: true` answered 200). An unknown model is refused 404 with `{"error":{"message":…,"type":"model_invalid"}}`.

## A request without a system message is not neutral

Measured, twice: `{"messages":[{"role":"user","content":"hi"}]}` with no system message answered as a persona nobody asked for — one reply built a cyberpunk FUI page, another opened "We need to produce a response as a top creative frontend developer", and a third model's own thinking quoted a system prompt defining it as an FUI design expert. With a system message of our own, every row answered the instruction plainly. Something on the plan path supplies a default system prompt when the caller sends none. Every call from this monorepo carries its own instructions, so this affects nothing here, but a probe that sends none is reading that persona rather than the model.

## What the plan does not expose — and where its usage actually lives

There is no usage or credit read on the API-key surface. Measured: 33 candidate paths across `/step_plan/v1/...` and `/v1/...` on `api.stepfun.ai` all answer 404, and `/v1/accounts` reports the pay-as-you-go balance, which a plan call does not spend. A live plan reply carries no allowance either — its headers are `x-trace-id`, `cache-control`, `x-upstream-latency`, `x-proxy-latency`, `x-router-id` and nothing about credits.

The data is not missing; it sits behind a different door. The console's own front end calls a Connect-RPC service, `step.openapi.devcenter.Dashboard`, served from `https://account.stepfun.ai/api/...` (and proxied on `platform.stepfun.ai`) — read out of the console's shipped JavaScript chunks on 2026-09-22. Its `QueryStepPlanUsages` method answers exactly the credit figures the console shows: `records[]` of `{from_time, to_time, model_id, calls, credit_consumed}`, plus `status`, `desc`, `total`. `QueryStepPlanRateLimit`, `GetStepPlanStatus`, `QueryAccountBalance` and `DevQueryUsageHistory` live in the same service, and the tier fields seen in the same chunks are `credit_amount`, `credit_buckets`, `credit_consumed`, `credit_deducted`, `credit_expire_at`, `credit_granted`, `credit_limit`, `credit_monthly_limit`.

That service authenticates a logged-in browser session, not an API key. Measured: every call answers 401 `{"code":"unauthenticated","message":"auth failed: token is missing"}` with vendor error code 120000 — including `Ping`. The pasted console key was refused in twelve placements: `Authorization: Bearer`, `Authorization: apikey`, `Authorization: Basic`, `x-api-key`, `X-API-Key`, `token`, `X-Step-Token`, the `StepAI-Attach-*` pair the console itself sends, and cookies named `token`, `session`, `step_session_id`, `stepfun_token`, pressed onto both `account.stepfun.ai` and `platform.stepfun.ai`. The front end sets no `Authorization` header of its own — it relies on `credentials: "same-origin"` with an httpOnly session cookie — so there is no header a client could replay even with a token in hand.

The boundary is therefore the vendor's, not a missing operation: the key that buys inference reads no billing, and the door that reads billing takes a web login. A client holding a pasted key can show no credit gauge; the only way through is an operator-supplied session cookie from `account.stepfun.ai`, which is a whole-account credential — it can create keys, change subscriptions and read invoices, where an API key can spend a plan — and it expires on its own.

Prompt caching is automatic above 256 input tokens and priced at a fifth to a tenth of a miss. No lifetime is published: eviction is described as load-dependent LRU with no figure, and whether the Anthropic wire caches at all is undocumented.

## Prices and tiers, as published

Per million tokens: `step-5-preview` $1.00 miss / $0.05 hit / $2.70 out; `step-3.7-flash` $0.20 / $0.04 / $1.15; `step-3.5-flash` and `-2603` $0.10 / $0.02 / $0.30. Plan tiers carry monthly credits at about $1 ≈ 7M credits, cleared at month end with no rollover: Flash Mini 400M at $6.99, Flash Plus 1600M at $9.99, Flash Pro 8000M at $29, Flash Max 40000M at $99. The plan is stated to be outside the platform's tiered RPM/TPM limits, and no concurrency figure is published in its place.
