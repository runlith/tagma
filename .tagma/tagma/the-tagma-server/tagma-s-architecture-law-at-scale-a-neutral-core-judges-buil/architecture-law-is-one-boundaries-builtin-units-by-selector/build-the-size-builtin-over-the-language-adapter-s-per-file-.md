---
id: 01a0f4ab-e30b-7680-890d-12a1593cb8c4
title: Build the `size` builtin over the language adapter's per-file metric
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0f4db-4a6a-7b37-ab5c-37dc823931ca",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0f476-04fc-7cb9-bf49-deb7bedb212a
---
Build `size`: a builtin that ratchets a per-file metric the language adapter supplies and parses nothing itself ([[bedb212a]] §4.4). Changes no law in force; re-adopting [[6b3210c7]] onto it is a separate act on the operator's word, after this lands.

**Class:** medium — `claude-sonnet-5-5` high.

**Target:** parameters `base`, `files`, and thresholds per glob (`lines`, with the metric `non-import`); a violation is a file over its threshold with `value` = its measure, keyed by the file; the adapter's metric comes from `@runlith/code-facts` (`Declarations.lines`, `importLines` exist); a file whose adapter supplies no metric is unsupported (`unjudged`), never zero; `tightens` proves a lower or equal threshold and kept or widened files. It lives in the `repository` pack until the pack is renamed `architecture`.

**File scope:** a new `apps/tagma/inspection/src/packs/repository/size/**`; `packs/repository/manifest.ts`, `packs/repository/implementations.ts`; `packages/code-facts/src/**` only if the metric needs a neutral door.

**Acceptance:** `check_rules` with an unsaved `size` inspection over 6b3210c7's region, threshold 650 non-import lines, reports the same files and values as 6b3210c7's current ledger (record both in the close); typecheck; tests for the ratchet and the unsupported case.

**Reviewers:** one Muse lens (parity with `names` F4), `gpt-6.1-sol` high general.
