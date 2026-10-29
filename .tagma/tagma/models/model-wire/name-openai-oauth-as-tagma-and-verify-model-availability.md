---
id: 01a12be7-f533-7714-8010-f7ade9372ca3
title: Name openai-oauth as tagma and verify model availability
ord: 35
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12be7-58e2-7c24-ad2e-cc68a3f0f719",
    "status": "done"
  }
---
Replace the Codex originator and User-Agent with the Tagma name and build in openai-oauth and its authorize URL, keeping the client id and backend. Check the client-build change history and, on the operator's account, compare the catalog and the minimal answer of each menu model before and after; do not print the token source, do not restart the server. Completion is proven by typecheck and contract tests, independent Sol xhigh and Muse review, live results, and the landed commit.

The implemented originator is `tagma`; the User-Agent is `tagma/0.1.0 (darwin 25.0.0; arm64)` on the checked machine, with the single program number from platform/contract/wire/program.ts (PROGRAM_RELEASE) shared by the CLI, the harness, and the providers, and real host facts from node:os. ProductIdentity is passed in text/drawing/quota; both OAuth begin flows use the default `tagma`. The Codex client id, backend, routing hint, and session affinity are preserved. Historical native Codex captures and RECORDED_PRODUCT were not rewritten.

Live 2026-10-11, current account of the OpenAI thread: gpt-6-astra, gpt-6.1-sol, gpt-6-sol, gpt-6-luna, gpt-5.6-sol, gpt-5.6-terra, gpt-5.6-luna, and gpt-5.5 completed minimal SSE requests with HTTP 200 / response.completed under three identities: the old codex_cli_rs/0.153.2; tagma/0.1.0; tagma/0.153.2. The `version` header was not sent. After implementation, requests of all eight built by the real production registration/profile/prepare/auth returned `OK` and a matching returnedModel: 18 input tokens each, 5 output for seven of them and 20 for 5.5. In the initial probe of the old identity, completion and 5 output tokens are preserved for Astra/5.6 Luna/5.5, but not the stream-delta text; they are not reported as a literal `OK`.

GET backend/models requires the `client_version` query: without it HTTP 400; with 0.1.0 the catalog is empty, with 0.153.2 it lists Astra/5.6/5.5, with 0.155.0 it adds 6 Sol/Luna, with 0.160.0 6.1 Sol. With the same query all three identities return the same catalog; with 0.160.0 all eight menu models are present, 5.5 with hide visibility. This is GET filtering; production holds a static menu and never calls this GET. Tagma's own number in the UA did not limit inference, so neither the Codex number nor an extra header was added.

History: 705fbe1f1d (2026-07-10) raised the `version` header and the Codex Desktop UA from 0.124.0 to 0.144.0 and replaced session_id with session-id; the originator was preserved. 2c3d5c9708 moved the form into packages/llm. cc0a46f0f8 (2026-09-04) changed it to codex_cli_rs/0.153.2 and removed the `version` header. Before this work the Codex number lived only in the UA. Git does not prove which of the two simultaneously updated fields lifted the previous gate.

Checks: bun run typecheck from server passed with all dependencies; after the review-driven tests the llm typecheck passed again. 22 profile/OAuth/model unit tests and 14 tests of the three affected integration suites were checked after fixing the old test producer: it returned mcp__tagma__read with RECORDED_PRODUCT.mcpServer=tagma; it now uses the declared namespace. Module gates: 0 violations; git diff --check clean; the source CLI answers tagma v0.1.0. The operator's server was not restarted; image inference and other accounts were not measured.

Sol xhigh finished the main review with no findings. The Muse lens pointed at incomplete host coverage and the explicit OAuth caller: positive checks of the real node:os metadata and the passed originator were added. Negative guards on the absence of the version header and on catalog staticness were not added: these prohibitions are not a contract, and the need for the header was studied as a condition, not an eternal ban. Loopback/default was read in code; this work has no separate loopback test; the live image call was not among the eight text models checked. The code landed in 5c5c4c6bdc; the review-driven tests in ca5b229496.
