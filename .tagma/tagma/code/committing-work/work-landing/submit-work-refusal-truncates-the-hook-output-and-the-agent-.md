---
id: 01a145bd-8cda-78ca-abf8-f08883f3433b
title: submit_work refusal truncates the hook output, and the agent cannot see why the commit was rejected
ord: 134
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1457e-b3df-721a-b633-e86cc903d6a8",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1457a-68dd-7223-b670-35134eaefe53
---
In Exp3 the Ghostfolio pre-commit (`nx affected:lint`, then `format:check`) rejected `submit_work`. The refusal ended at `✔ nx run common:…`: the head of the output (npm warnings, nx progress) ate the whole budget, and the error lines never arrived. The agent spent three steps finding it itself via eslint and prettier.

What to do: show the tail of the hook output (where the error is) in the refusal, not the head, or the full output at an address the agent can read.

Where to start: assembling the landing refusal's `reason` in `apps/tagma/server/src/landing/`.

Done when: a hook that fails after long progress hands the agent the error lines; there is a test for this contract.
