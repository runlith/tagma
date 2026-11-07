---
id: 01a1b36d-0df9-7752-9a65-8098b515f42a
title: Speech reports its faults on a plugin's `speech` point, and an import failure there only for a part that brings no models
ord: 28
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/speechSources.ts
---
One owner per fault point: the model registry owns `providers`, speech owns `speech`, and each clears only its own point when a later set no longer carries that plugin's fault. A part that brings both models and speech is imported once per revision directory (one ESM instance for both readers), and its import failure is the registry's to report; speech reporting it too would show the same failure twice on the card and would clear it while the registry still holds it. Speech's own faults — a provider that breaks the catalog rules or repeats an id — always go on `speech`, whatever else the part brings.

The speech filler memoizes an import per revision directory, its failure included: a revision is immutable content, so re-importing the same directory cannot succeed later; a fixed plugin arrives as a new revision.