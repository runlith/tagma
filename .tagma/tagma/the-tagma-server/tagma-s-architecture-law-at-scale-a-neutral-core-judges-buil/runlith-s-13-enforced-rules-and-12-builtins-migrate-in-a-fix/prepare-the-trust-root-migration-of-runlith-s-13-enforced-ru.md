---
id: 01a0f747-8334-7c27-ac18-1e8a814c2efe
title: "Prepare the trust-root migration of runlith's 13 enforced rules: each rule's enforce_rule input measured against its current verdict, and the semantic delta of the 083d37f1 conversion for one approval"
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0f746-df9a-7404-b011-6422c49a76e4",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0f476-0526-7928-a1ce-c58bcdf2a89f
---
Prepare, measure and document — adopt nothing and change no rule's enforcement ([[cdf2a89f]] §4.2, §4.3, §4.4).

**Target:**
- For each of the 13 rules of [[cdf2a89f]] §3: the exact `enforce_rule` input it takes after the trust root (inspection or policy, triggers, strictness, owners), measured with `check_rules` over an unsaved `inspection` and `over: "all"`, and compared with the rule's current verdict — violations, debt, values; every divergence explained.
- The conversion of [[083d37f1]] (§4.3): `boundaries` policies for the server's entries, the packages' law and each kept prohibition; all configured package entries compared with their manifests' `exports`, each mismatch decided as an entry, a manifest fix (committed when the manifest is wrong) or a prohibition; the semantic delta grouped by meaning; debt only where the new policy refuses an import standing at HEAD, with owners.
- One plan document and one semantic-delta document in the session's scratch, for the lead and the operator's single approval.

**File scope:** scratch documents; `packages/*/package.json` only for a proven manifest error.

**Acceptance:** every replacement's `check_rules` figures are in the plan beside the current verdict; the delta document covers every configured package entry and groups what the conversion removes; nothing adopted, no enforcement written.

## Delivered

The plan, the exact `enforce_rule` inputs (with `absorb` where a builtin change renames debt keys), every `check_rules` input and answer at HEAD `6cd4abac`, and the semantic delta of [[083d37f1]] stand in the scratch of thread `01a0f746-df9a-7404-b011-6422c49a76e4` (`plan.md`, `delta-083d37f1.md`, `enforce-inputs.json`), handed to the lead. Commit `ca33fd7e14` pins the Python adapter in the `runlith-law` descriptor, without which the prepared checker failed to start. Reviewed once by a Sol reader; its seven findings were corrected (absorb, harness wire floors, layer test-utils, closed packages, same-unit testing, retained measurements, coverage).

Open beyond this task: the operator's restart onto N+1 and trust root; [[ea465bed]]'s 24 unjudged sites; [[99b5c911]]'s port to contract 2 with no task; an owner for the `$app/*` debt; `boundaries` cannot hold "production code does not import its own testing surface".