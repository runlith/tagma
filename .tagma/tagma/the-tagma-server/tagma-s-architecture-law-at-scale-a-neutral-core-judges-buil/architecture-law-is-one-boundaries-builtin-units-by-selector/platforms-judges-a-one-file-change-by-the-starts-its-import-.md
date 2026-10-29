---
id: 01a0f7c0-4ea2-7864-8d2c-fc4023e52ffc
title: platforms judges a one-file change by the starts its import closure reaches, with incremental == full parity
ord: 6
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0f7bf-c1c6-731c-bacb-88953e717385",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0f476-04fc-7cb9-bf49-deb7bedb212a
---
Commit of one file in runlith costs ~10 s; `platforms` ([[50520d64]]) takes 3.3–5.0 s of it, growing with the repository instead of the change (rule [[2393aff1]]).

- Measure first, by stage: `platforms`, `modules`, and everything around the checks (index, hooks, publication, git).
- Fix at the owner `apps/tagma/inspection/src/packs/js/platforms/**` (and `@runlith/code-facts` reverse index where needed): a change reads and judges only the starts whose import closure passes through changed/added/deleted paths, or through a changed manifest/resolver input — as `boundaries`' reverse impact (§4.5).
- `modules` is not optimized (it retires with [[083d37f1]]'s conversion); a removable cause in the surrounding 2–3 s is fixed at its owner or named.

Acceptance: a parity test incremental == full on fixtures (an added file, a deleted file, an `exports` change, an entry-point change); the same one-file commit measured before/after on one machine as a sample; claims written from the code.