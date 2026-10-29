---
id: 01a0f81a-bc13-7bd3-87d7-cc6cc6e8bea1
title: "A one-file landing pays only for what it changed: per-file reach memo, diff-priced record checks, structural listings, admission reuse, parallel rule judging, memo surviving a worker stop, foreign app config invalidation"
ord: 7
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
Follow-up to [[23e52ffc]], ordered by the operator through law-opus. Each item fixed at its owner, measured before/after on the two samples (`apps/tagma/server/src/platform/rereading.ts` +1 import, `packages/agent/src/protocol/compositionParts.ts` 1-line edit), cold and warm, with a contract test where it is a contract; `incremental == full` parity holds throughout.

1. `platforms` walk.ts `readSlice`: an affected start reuses unchanged files' reach from the memo instead of re-walking its whole in-slice closure.
2. records.ts `unitDigest`: record validation costs the paths changed between trees, not the package's size.
3. treeMemo.ts `derived`/`patched`: add, delete and edit update the listing structurally, without copying or sorting the whole index or overlay.
4. `submit_work` git operations: admission work repeated per operation (`TerminalTargets.resolve`, `FileRoots.resolveFootprint`, `Terminals.start`) is done once at its owner, admission kept.
5. Rules at one landing are judged concurrently within the worker budget (at most 3, rule 5ca40326).
6. The inspection memo survives a worker's idle stop: the first landing after a pause is not cold.
7. A foreign app's `svelte.config.js` change invalidates the memo of starts in packages that discover its workers.

Done when every item is landed with its measurement, an independent Sol high review's findings are fixed, claims are written from the code and drift after these commits is reconciled.