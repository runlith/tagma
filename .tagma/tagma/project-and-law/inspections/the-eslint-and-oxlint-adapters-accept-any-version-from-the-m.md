---
id: 01a15ba1-aa7b-74a8-925f-7d97a38d657a
title: The ESLint and oxlint adapters accept any version from the minimum carrying their API, and an inspection failure is not passed off as a clean result
ord: 60
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15ba1-f303-7ada-9b32-e23b810d9f49",
    "status": "done"
  }
sources:
  - kind: dir
    ref: apps/tagma/inspection/src/runners
---
Found on law-lab: `Linters.eslint` refused a project on ESLint 9.39.5 — "ESLint 9.39.5 is not the 10.11.0 this adapter reads" (`apps/tagma/inspection/src/runners/eslint/adapter.ts:74`); oxlint has the same exact comparison (`runners/oxlint/adapter.ts:95`). The operator's decision: there is no exact version, only a minimum on the API the driver uses; below the minimum the refusal names the needed and the found versions. In the same change: `check_rules`, when an inspection has failed, does not write "submit_work would land this change" and "no violation" next to it; `enforce_rule` answered `reach: none` while `read_enforcement` on the same `4e5d1446` rule in law-lab said "the whole base": establish which is right and fix at the producer.
