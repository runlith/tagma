---
id: 01a11901-5360-733e-9ca2-9123ae16171c
title: "Runtime-chat event model: decoded union, settlement projector, entry deltas with feedPosition"
ord: 21
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a118eb-3e7e-7085-8f2e-2cd5c3436715
  - kind: waits-on
    to: 01a11901-5360-733e-9ca2-9121a7add807
---
Implements [[c3436715]] with its consumer side [[b7bb8a8f]] (chat audit).

Delivered: 5e79d6dd14, 9c0efa0bfa, f2f02f4b79, a94e2a1881, 30dc781212, 754ff04de5, 08efded82b, d6580470f7, ce54afe5fd, dd6b9eec58, fc49a7f3ea, f4de83b79d, dbb6058ee4, 27b27ba9bb, 4cc1cc817c, a1919e8f41.

Proven by tests:
- reader-folded deltas equal rows (`feeds.test.ts`, `feedPairs.itest.ts`, `ThreadLiveFeed.test.ts`);
- exactly one run-end per run, and none for withdrawn (`RunLifecycle.test.ts`, stops conformance);
- settlement-projector cases where `status:'refused'` in the data stays a success;
- unknown kind yields `ThreadEntryUndecodable`, while a product kind decodes (`kinds.test.ts`);
- old-form migration in storage (`entryFormsStep.itest.ts`) and in rollout files: plain, `.zst`, repeat pass, refusal on a broken file (`rolloutEntryForms.itest.ts`);
- decoding a rollout-corpus sample: 262 of 3136 files, 200,242 payloads, zero refusals after the step.

Review round (26 items): 87bb47b18c, a03673d2ff, 19a26c90f3, 5a5d172d19f, 04bd224e25, ee3fc27349, 46e1e798cc, 983a42d36d, 5ac212266c; feed pairs in [[1d419d4f]] (e4f9c8c14f). Full corpus decode for reading only: SQL — 290,367 entries, 845,623 payloads and 2 stream-tail entries; rollout — all 3159 files, about 9 GB. Zero refusals after the step except one found failure shape without `account`, which the step now fills. Split into tasks: [[a10fed73]] (union type and registry as service), [[30414380]] (arrival attachments), [[5a674b6c]] (incremental rested reads).

Not proven or open:
- the `thread.subscribe` wire schemas, snapshot, and evidence still take the open entry shape: they can only close in the browser once the app registers its kinds there;
- the memory adapter has no stored old shapes, so migration conformance runs on SQL only;
- the rollout step never ran over a real `~/.tagma/threads`: it runs on this branch's first server start by a human.
