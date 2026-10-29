---
id: 01a14c08-619e-7ae1-af8b-16c8362f480f
title: The agent or the operator speaks text aloud on the server machine
ord: 9
tags: ["feature"]
fields:
  {
    "state": "live"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/speech/Speak.svelte
  - kind: file
    ref: apps/tagma/server/src/speech/contract/wire/speaking.ts
  - kind: file
    ref: apps/tagma/server/src/speech/speaking.ts
---
**Value.** The agent or the operator speaks text aloud on the server machine — announce the work end, read an answer, check a voice.

**How.** The `speak_text` and `stop_speaking` operations; the agent receives them as speech tools. The operator — the Speak card in Settings → Speech: phrase, "Speak", and "Stop". The voice is `speech.voice` or the one named in the call.

**Behaviour.**
- The call answers as soon as the voice is chosen and synthesis started, naming the provider, model, and voice; the sound then plays itself.
- `stop_speaking` mutes everything the machine currently speaks and answers how many voices fell silent; a stopped phrase is not finished.
- In review mode both acts ask the operator.

**Limits.** Sound plays only from the server machine speakers; on a phone and in another browser it is not heard. Voices are now given by Soniox and OpenAI; there is no local synthesis. A view's own voicing is led by its bridge, not these operations.
