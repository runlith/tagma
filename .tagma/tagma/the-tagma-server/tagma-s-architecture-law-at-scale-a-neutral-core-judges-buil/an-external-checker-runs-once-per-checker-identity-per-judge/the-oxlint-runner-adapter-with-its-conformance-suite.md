---
id: 01a0f4ab-e31e-7d8d-8fe3-ebc6be843c7e
title: The `oxlint` runner adapter with its conformance suite
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0f587-c5d4-751f-8a26-9ebf3da862e9",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0f476-04de-7739-9ff5-ba99d11108eb
  - kind: waits-on
    to: 01a0f4ab-e311-7a99-af0d-be9c544301b1
  - kind: waits-on
    to: 01a0f4ab-e316-7f2b-bdee-e44c081cfd4b
---
Build the `oxlint` runner adapter with its conformance suite ([[d11108eb]] §4.2–4.5): the `files` layout running both sides in one invocation, directive blanking through oxlint's real comment grammar, SARIF decoding, exit-code meaning, the tool's identity read for [[b2965d21]].

**Class:** complex — `claude-opus-5-5` high.

**File scope:** a new `apps/tagma/inspection/src/runners/oxlint/**` (decoding, grammar, conformance fixtures) and its execution road in `apps/tagma/server/src/enforcement/programs/**`.

**Acceptance:** the conformance suite — exit codes, unsuppressed readings equal to readings with directives blanked (old and new directives, ranges), `files`-layout equivalence to a normal run, fingerprint stability across edits; ten norms on one descriptor judge with one oxlint process for both sides (span); a fixture project's plugin rule is adopted and judges with no Tagma release.

**Waits on:** the contract 2 task, the checker identity task.

**Reviewers:** Muse lenses (suppressions; performance), `claude-opus-5-5` xhigh, `gpt-6-astra` xhigh (law-astra).
