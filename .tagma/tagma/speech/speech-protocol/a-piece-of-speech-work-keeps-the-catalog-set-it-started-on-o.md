---
id: 01a1b33c-9069-7ea5-af55-5fe8d580d210
title: A piece of speech work keeps the catalog set it started on; only one-shot reads take `Speech.now` at each call
ord: 12
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/speech/src/engine/Speech.ts
  - kind: file
    ref: packages/speech/src/engine/set.ts
  - kind: file
    ref: packages/speech/src/engine/catalog.ts
---
`Speech` answers sets, not providers: each change of `SpeechSources` builds a new `SpeechSet` bound to one catalog, and the previous one stays valid for whoever holds it. A recognition takes its set before choosing the recognizer and keeps it to its last utterance, a synthesis from its voice to its last sample, a transcription from its job to its result. Work takes its set with `Speech.take`, which holds it until the taking scope closes; `Speech.revisions` names the revisions the current and every held set were built from, and `released` fires when a held set drops, so a holder of revision directories keeps a revision exactly while some work still runs on it. A set runs a choice only when its model object is the one its own provider declares, so a choice made on another revision is refused rather than run on a different provider's code.

ESM never unloads, so a provider withdrawn or replaced mid-way keeps running its started work from the module it was loaded from. A synthesis model's `streams` limit lives with the provider object, not the set, so two sets carrying the same provider share one semaphore and a reload does not double the vendor's concurrent streams; a new revision is a new object with its own limit.

`SpeechSources` answers `current()` and `changes`, so `Speech` builds its first set without waiting on a stream. The catalog judges every provider whole inside one guard — its shape, credential form and availability, each declared model decoded against the capability schemas of `wire/capabilities`, and every declared road (`stream`, `batch`, `file`, `resume`, `discard`, `open`) a function; one that fails, declares an id an earlier part holds, or uses an id `taken` names for another owner is left out with a fault naming its owner, and the others stand.