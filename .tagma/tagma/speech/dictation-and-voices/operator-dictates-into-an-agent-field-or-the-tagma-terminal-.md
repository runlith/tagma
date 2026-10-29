---
id: 01a14c08-619e-7ae1-af8b-16c009901e65
title: Operator dictates into an agent field or the Tagma terminal by holding a key or the microphone button
ord: 1
tags: ["feature"]
fields:
  {
    "state": "live"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/terminal/Dictated.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/speech/dictation/Dictation.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/speech/dictation/field.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/speech/dictation/Keys.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/speech/dictation/MicButton.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/speech/dictation/Plaque.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/speech/dictation/take.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/speech/dictation/Targets.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/speech/VoiceInput.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/dictation.composer.svelte
  - kind: file
    ref: apps/tagma/server/src/speech/listening/hearing.ts
  - kind: symbol
    ref: apps/tagma/server/src/speech/contract/wire/operations.ts
    symbol: RECOGNITION_OPERATIONS
---
**Value.** The operator speaks instead of typing: the text lands where the cursor is — in an agent field or in the Tagma terminal. Whether to send it is their own call.

**How.** Holding the dictation key (the `speech.dictation.key` setting, `⌥ Space` by default) or the microphone button next to send in the composer. A short press starts recording until the next press. Underneath are the `speech.recognize` feed and the `finish_recognition` operation, both available only to the operator.

**Behaviour.**
- The target is picked by focus: an agent field or a terminal. With focus on neither, the text goes to the visible agent field. With none of those, dictation does not start, and a notification explains why.
- In an agent field the confirmed text grows directly in the draft, with the unsettled hypothesis shown in grey after it. In a terminal the live text stands in a plaque above the panel, and only the final phrase is inserted into the terminal on release, without Enter.
- On release the server asks the recognizer to confirm the tail. The window waits about two seconds, then inserts the confirmed text together with the latest hypothesis.
- If the field was sent, hand-edited, or closed before dictation ended, what was already in it counts as inserted. Only words arriving after that get a notification: a short line, the words themselves under an arrow, and a copy button.
- `⇧` on release sends the message to the agent, but only when the tail is confirmed and nothing was lost; otherwise the text is inserted without sending, with an explanation. `Esc` cancels dictation and removes what it inserted, unless the operator edited it.
- Next to the microphone are a level meter and a hint when the microphone stays silent for long. While recognition is not open, the microphone shows the reason instead of recording (see the speech-readiness record).
- The dictation recognizer is its own (`speech.dictation.recognizer`, falling back to the shared one when empty); languages and microphone are shared with the rest of speech.

**Limits.** One dictation at a time per window. Dictation knows no other window fields besides the agent field and the terminal. There are no voice commands: what is said is what is typed. Reconnecting the live channel mid-dictation ends it. The server records audio on its own machine; a paired device records its own audio (a separate record).
