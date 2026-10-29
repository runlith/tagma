---
id: 01a1326b-d8f7-740e-accf-9321317a8c04
title: "Implement vendor web for openai-oauth per spec 069b6f38: Codex web capture, generalized VendorWeb, read condition, model-based RunWebs decision, vendorWire and namespace in OpenAI Responses, web.run executor"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1326c-27e7-7b3a-a6ac-14c4c9f1d329",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a13264-ec72-7709-8cb8-15fe069b6f38
sources:
  - kind: file
    ref: packages/adapter-openai/src/profiles/codexWeb.ts
---
Do what [[069b6f38|spec]] describes, in its order: contract and harness, wire, profile.

Done when the spec acceptance criteria hold: capture runs in the corpus, owner contract tests, Claude's `web` replay gate with no diffs, typecheck and the tests of the affected packages, note [[cccbfb07]] rewritten. The operator does the live check on gpt-5.6-sol — it is named in finish, not waited on.

**Result (commit b98fc15934).** Verified: typecheck and the tests of the affected packages, Claude's `web` replay gate (3 runs, 0 diffs), two live requests through the `openai-oauth` route on gpt-5.6-sol (namespace in `tools` accepted, history repeat with namespace accepted), a `tool_choice` probe (the wire does not express a namespace function by name).

Left to the operator: a live native thread on gpt-5.6-sol searches and opens a page through `web.run`; in review the page opening asks; `agents.web = tagma` returns Parallel and Exa. The search endpoint itself was never called from Tagma — its request is verified only by a test with a stubbed transport against the recorded Codex shape.

Not proven by test: the `threadWeb` decision over setting and road branches (behavior unchanged), that search opens no `model-call`, Claude parity outside a manual gate run.
