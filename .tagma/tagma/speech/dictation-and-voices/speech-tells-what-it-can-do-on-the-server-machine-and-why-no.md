---
id: 01a14c08-619e-7ae1-af8b-16c36d1dd9bb
title: "Speech tells what it can do on the server machine and why not: devices, permissions, models, and dictation readiness"
ord: 4
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
    ref: apps/tagma/app/src/lib/features/speech/Devices.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/speech/dictation/blocked.ts
  - kind: file
    ref: apps/tagma/server/src/composition/speech.ts
  - kind: file
    ref: apps/tagma/server/src/speech/contract/wire/status.ts
  - kind: file
    ref: apps/tagma/server/src/speech/status.ts
---
**Value.** The operator and the agent know ahead whether speech can work on this machine, and if not — why and what to do: grant a permission, save a key, install a model, install a helper.

**How.** The `speech_status` operation (the agent sees it too). Settings → Speech, the "Audio on this machine" card: input devices, microphone choice (`speech.microphone`), microphone and system-sound permissions with the system-settings button, status refresh. The microphone button in the agent field shows the same reason instead of recording and leads to settings.

**Behaviour.**
- The status answers about the machine the server runs on: is there a sound helper, which inputs, what macOS permitted, is the speech detector ready, for each recognition and synthesis model — can it work now and why not, which local models stand.
- Separately it says whether dictation is ready and with which model: it goes through the same choice as the real run.
- For a bound device the status says the device writes the sound; then the button checks the browser microphone, not the Mac's.
- The sound helper is looked up on each request, so one that appeared after startup is found without a restart.

**Limits.** Sound capture and playback exist only on macOS; on another OS the status says so. Dictation from a bound device does not depend on the machine sound; on a server outside macOS this is read from code but not checked by a run. A permission "not asked yet" is asked by the first capture, not settings.
