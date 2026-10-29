---
id: 01a14c08-619e-7ae1-af8b-16c6e3e31886
title: The check in speech settings shows recognized text and the microphone and system sound levels, saving nothing
ord: 7
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c08-619e-7ae1-af8b-16c36d1dd9bb
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/speech/Check.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/speech/check.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/speech/CheckPanel.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/speech/TrackRow.svelte
---
**Value.** The operator makes sure in half a minute that the microphone and system sound are heard and the recognizer understands them — before an important call and with no trace in the project.

**How.** Settings → Speech, the Check card: pick a microphone, system sound, or both, "Start check" and say a phrase. Underneath — a `speech.recognize` feed with no recording.

**Behaviour.**
- Before starting, the card shows for each source what blocks recording, with a system-settings button.
- During the check each track shows the level, recognition phases, and troubles — for example a long silence; below, the recognized text grows and breaks are marked.
- The check ends itself when all tracks end, or by "Stop"; a connection break ends it with an explanation.

**Limits.** Nothing is kept. The check runs the default recognizer.
