---
id: 01a123b9-6f1e-770d-87b7-6b4cace6da34
title: A view's speech capability belongs to its mount and uses the server's speech
ord: 5
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/speech/Playback.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/speech/viewSpeech.ts
  - kind: file
    ref: apps/tagma/server/src/speech/contract/wire/view.ts
---
Speech contributes the `speech` member to the window's `ViewCapabilities` point, declared in its own server wire; `plugin-views` names no speech. The member offers `status`, `recognize`, `speak` and `silence`.

`recognize` picks the microphone from `speech_status`. On the server's machine the server captures; on a tethered device (`caller`), the window's existing `Sender` does. The client makes the recognition's id, so another view cannot finish it from a guessed one. The `speech.recognize` feed is held through the live connection; the listener's `ended(failure)` is called once, with `null` for a clean end. A recognition also ends with a failure when the live connection pauses, is refused or closes, and it does not reopen by itself. `finish` is accepted only after the `state: live` event: it calls `finish_recognition`, rereads the tail and lets the recognition end by itself. `stop` cuts it at once. The mount's end stops every recognition of that mount and silences its playback.

`speak` receives the speech owner's `speech.synthesize` stream: first the chosen voice and format, then PCM16 little-endian. The window's `Playback` plays it through Web Audio on the view's device and answers the voice once playback ends; stopped voicing rejects. `silence`, a new phrase and the mount's end remove only that mount's voicing. The server's `speak_text` and `stop_speaking` keep their own consumers and take no part in a view's voicing, and synthesis never opens the server's audio device. The window holds about two seconds of scheduled audio, then waits for playback before accepting the next frame. For this paced stream, `LiveConnection.hold` opens a separate scoped channel, so waiting for audio delays neither the other feeds nor the shared connection's heartbeat; removing the subscription closes it. The synthesis owner delivers frames as separate packets, so RPC never packs many seconds of audio into one chunk. An MCP App window never receives this member.
