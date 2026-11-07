---
id: 01a1b36d-0df9-7752-9a65-8098b515f42a
title: Speech reports its faults on a plugin's `speech` point, and an import failure there only for a part that brings no models
ord: 28
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/speechSources.ts
---
One owner per fault point: the model registry owns `providers`, speech owns `speech`, and each hands its whole point to `PluginFaults.replace`, which clears that point on every plugin the new map leaves out. A part that brings both models and speech is imported once per revision directory (one ESM instance for both readers), and its import failure is the registry's to report; speech reporting it too would show the same failure twice on the card and would clear it while the registry still holds it. Speech's own faults — a provider that breaks the catalog rules or repeats an id — always go on `speech`, whatever else the part brings.

One owner (`SpeechParts`) holds the only subscription to `ProviderParts`, imports, and publishes only when a speech part moves, so a models-only change rebuilds no speech set; it needs no Whisper engine, so the model credentials it feeds keys to build none. The installation adds Whisper and the model ids other plugins serve (`taken`, only ids some speech part declares). A revision directory is leased through `PluginRevisions.hold` for the whole time its part imports, and the filler registers its own holder naming the parts it last handed Speech, so a revision is never swept between selection and the set Speech publishes from it; a lease refused because the directory is already gone re-reads the current provider parts. The speech filler memoizes an import per revision directory, its failure included: a revision is immutable content, so re-importing the same directory cannot succeed later; a fixed plugin arrives as a new revision.