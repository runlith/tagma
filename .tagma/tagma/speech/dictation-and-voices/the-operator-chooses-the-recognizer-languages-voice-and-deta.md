---
id: 01a14c08-619e-7ae1-af8b-16c5b3ad0acb
title: The operator chooses the recognizer, languages, voice, and detailed model settings once for all speech
ord: 6
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c08-619e-7ae1-af8b-16c009901e65
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/speech/Languages.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/speech/Recognizer.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/speech/Section.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/speech/Voice.svelte
  - kind: file
    ref: apps/tagma/server/src/speech/keys.ts
  - kind: file
    ref: apps/tagma/server/src/speech/listening/choice.ts
---
**Value.** The operator once decides who recognizes and speaks for Tagma and how — and calls, checking, dictation, and the agent take it themselves without asking the model each time.

**How.** Settings → Speech, the Defaults card: recognizer (`speech.recognizer`) and who cuts turns — the provider, Tagma, or nobody; detailed tuning controls declared by the chosen model (`speech.tuning`); speech languages (`speech.languages`); synthesis voice with model and language (`speech.voice`). The Speech boundaries card — speech detector thresholds (`speech.segmenter`).

**Behaviour.**
- Unchosen is picked by capability: the first model that can do what's needed — live stream, languages, speaker separation — and is available now. A model that hears only a recorded file does not reach live choice.
- A call naming a provider or model overrides the setting; dictation and re-recognition hold their own keys, and empty ones take the shared.
- Languages are a hint to the recognizer in probability order; an empty list leaves detection to it.
- An unavailable chosen model is marked in the list and shows the reason beside it.
- Speech keys are user-only; they have no project layer.

**Limits.** Providers now are Soniox and OpenAI in the cloud and local Whisper; cloud keys are kept as model-provider console keys (A7), they are not entered here.
