---
id: 01a10dfe-bb8e-7f48-a7ee-28c462d4cbd1
title: "Voice from a tethered device: the phone records audio itself and streams it to the server, the server recognizes, the Mac microphone stays closed"
ord: 106
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a0ff30-3ce0-7879-8c00-c376b4ee7196
  - kind: relates
    to: 01a10b70-624a-788b-ba2a-cbe616b50a26
  - kind: relates
    to: 01a10b84-921f-7c42-a1d6-fc86c508fd35
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/features/speech
  - kind: dir
    ref: apps/tagma/server/src/speech
  - kind: file
    ref: packages/audio/src/sound/track.ts
---
Dictating from a phone into a phone: hold the microphone in the agent field, speak, the text lands in the field. The phone records the audio, the server on the Mac recognizes it with the same recognizer, keys and rules as [[16b50a26|dictation]]. The Mac microphone does not open in the process.

Right now the mobile shell draws the same microphone button (`features/threads/native/Conversation.svelte`), and it switches on the **Mac** microphone: a person in another city dictates into an empty room. This spec fixes that.

## Principle

The server owns recognition, the device the person holds records the audio.

- **At the Mac** (Tagma.app, a browser on the Mac itself, global dictation) the server writes audio through the helper, as now. That is better there: recording lives without the window, one TCC permission on the signed `Tagma.app`, system audio, own-audio exclusion, one microphone owner.
- **On a tethered device** (a phone, another laptop's browser through the remote door) the page records audio and streams it to the server. The server microphone is physically not where the person is.

Recognizing on the phone itself is rejected: provider keys would leave for the device, and vendor adapters would duplicate into the browser past the single speech protocol ([[b4ee7196|speech in Tagma]]).

## How it works

```
phone                                       server
MicButton ─▶ Dictation ─ speech.recognize {id, tracks:[{source:'mic', at:'caller'}], purpose:'dictation'}
               │                                   └▶ Hearings ─▶ capture(at) ─▶ Track ─▶ Soniox / OpenAI / Whisper
               └▶ Sender: getUserMedia ─▶ AudioWorklet 16 kHz ─▶ WS /api/speech/send?id=…  ─▶ Senders ─┘
               ◀─────────────── speech.recognize feed: text, hypothesis, level, end ───────────────
```

### Server, `speech` module

- **The joint is `Track`** (`packages/audio/src/sound/track.ts`). Recognition reads the `format` and the `Chunk | Gap | Ended` stream and does not know where the audio comes from. `Track` gains a second producer: besides `AudioDevices.capture`, a track the caller fills. Everything below `Track` is unchanged: recognizers, VAD, level meter, `finish_recognition`, the 15 s tail, the "losses block sending" rule.
- **The ask says where to record.** `TrackAsk` gains `at: 'server' | 'caller'`, default `server`. `caller` is allowed only for `source: 'mic'`: the browser does not hand over device system audio. `capture()` in `listening/track.ts` takes the `Track` from `AudioDevices` or from `Senders` by `at`. These are two producers of one type, not a vendor branch.
- **`Senders`** (`listening/sending.ts`) is the registry of caller tracks, keyed on the recognition id and track id. A track opens with recognition in `Hearings` and closes with it in the same `acquireRelease`. A sender that connected before recognition waits for its track up to 5 s: the window opens the feed and the socket almost at once, and their arrival order must not decide the outcome.
- **The upload channel** is a separate binary WebSocket `/api/speech/send?id=<id>&track=<track>`, one per track. The live channel's JSON-RPC does not fit a client audio stream: base64 and serialization on every frame. The route mounts next to the live channel in both doors (`composition/http/sending.ts`), so admission is the same remote-door gates on the upgrade context (`843f8d21`). A sender is not bound to a subscriber separately: every tethered device is the operator in full, and the recognition id is a random UUID only the window that opened it knows. An unknown id, a second sender on a track, and a wrongly sized frame are refused with a `sender-refused` code, and the socket closes with code 1008 and a reason. An accepted socket registers in `Connections` under the device from the upgrade context, like the live channel, so revoking the device closes it too. The socket reader holds the route scope, and closing frame 1000 or 1008 leaves before the reader is freed: otherwise Bun would close the socket with its own 1001 or 1011.
- **A frame** is a binary message: `seq` (u32 LE) and PCM16 LE mono 16 kHz, 20 ms (320 samples). The format is fixed, it is the `captureFormat`: the browser resamples, the server does not recompute. A message of a lone `seq` with no audio is the **last-frame mark**: the count of frames the sender recorded before release.
- **Time follows `seq`, not arrival.** `at = origin + seq × 20 ms`, so network jitter bears no gaps. A missed `seq` is a `Gap` with the new `transport` reason. The receive queue is bounded, and the socket is always read: stopped reading does not slow the sender, it piles frames in Bun's buffer without limit. A frame with no room becomes an `overflow` gap with an exact range, as with the helper. Gaps and the terminal `Ended` travel past the queue, so a full queue does not lose them.
- **The end.** `finish_recognition` travels as a separate request and can overtake the last frames in the socket, so the track ends on the last-frame mark, not on the request. The track waits for the mark up to 2 s after `finish`. With the mark it closes as `drained`, and frames missing before the mark become a `transport` gap. Without the mark the track closes with an open `transport` gap. The socket closes with code 1000 and a `finished` reason only when the track reached the mark without a single gap, otherwise `lost`. Then the tail as usual. A disconnected sender (an interrupted `send` call) loses the track the same way a torn socket does.
- **Recognition says it opened.** The first event of the `speech.recognize` feed after admission is `{ kind: 'state', state: 'live' }`. The window sends `finish_recognition` only after it: before admission the server does not know the id and would refuse `unknown-recognition`. Unsubscribing (`Esc`) closes the socket. When the socket closed early or the first frame did not arrive within 5 s of subscribing, the track ends with the new `sender-lost` reason. For dictation that is a loss: confirmed text stays, nothing is sent.
- **The recording chip.** `Capture` gains `at: 'server' | 'caller'`. The chip on the Mac says "on a tethered device", "Stop" works as now. There is no device name in the chip: speech does not know the devices module, and a name is not worth a new dependency.
- **`speech_status` says where the caller records.** The `mic: 'server' | 'caller'` field is `caller` when the call is admitted as a tethered device (`actor.deviceId`). The server knows this on every call, and the window needs no guess of its own.

### Window, `apps/tagma/app`

- **The connection decides where to record, not the shell.** `Dictation` takes `mic` from `speech_status` (from cache, or loading on press) and asks for `at` from it. Screen width and the mobile shell choice do not affect this: another city's laptop browser also records on its own side. When the status did not load, dictation refuses instead of recording the Mac microphone at random.
- **`Sender`** (`features/speech/dictation/Sender.ts`) is one dictation's object. On press: `getUserMedia({ audio: { echoCancellation, noiseSuppression, autoGainControl } })`, an `AudioContext` at the native rate and an AudioWorklet that averages it down to 16 kHz and cuts 20 ms frames: not every browser accepts an `AudioContext` at 16 kHz. Feed and socket open only after the microphone started, so the permission request does not eat the five-second first-frame window. Frames accumulate from the start, no more than 5 s, oldest leave first, and are sent in order as soon as the socket opens. When more than 64 KB waits in the socket, a frame is skipped: the server will see the `seq` miss as a gap, and the phone's memory does not grow on a stuck network. When the context did not start after `resume()`, that is a refusal, not silence. On release `Sender` asks the worklet to finish. The worklet answers `end` after all already sent frames, so the last-frame mark also counts frames still standing in the port. Without an answer in 300 ms the mark leaves without it, and such a dictation is never sent whatever the end: the tail may not have entered the count. Then `Sender` stops the microphone and puts out the OS indicator. A release with `⇧` that ended on the window's 2-second term sends the text only when the socket already closed with `finished` and no frame was dropped on the phone. Otherwise the text is inserted without sending, with a reason. Every unrequested socket close except 1000 after the mark is reported to `Dictation` as a loss with its reason: network tear, device revocation (4401) or server refusal (1008).
- **`Dictation`** is unchanged in essence: the same feed, `take`, targets, 2 s of rereading. It adds `at` to the ask and starts `Sender` when `at: 'caller'`. A release before recognition opened waits for the `live` event and then ends the dictation the usual way: what was already recorded is recognized.
- **The phone gesture** is the `MicButton` from [[16b50a26|dictation]]: hold to record, a tap shorter than 300 ms records until the next tap. No keys. The target is the agent field. There is no terminal on the phone ([[c508fd35|Tagma from a phone]]).
- **Why not.** The browser refused the microphone, the microphone is busy with a call or another app, the request was interrupted — dictation names the reason and the path (on iOS: Settings → Safari → Microphone, or the site permission). No `navigator.mediaDevices` or a non-HTTPS context is a reason too. Recognizer readiness still comes from `speech_status.dictation`.
- **Background.** iOS stops a PWA's microphone when it goes to background or the screen locks. On `visibilitychange` → `hidden` `Sender` closes the socket and reports it, the dictation ends as a loss: confirmed text in the field, nothing sent. Background recording is impossible without a native app.

## Order

1. Server: `at` in `TrackAsk`, `Senders`, the `/api/speech/send` channel, `Gap transport`, `Ended sender-lost`, `at` in `Capture`, `mic` in `speech_status`.
2. Window: `Sender`, `at: 'caller'` in `Dictation`, browser refusal reasons, the recording place in the chip.

The window depends on the server.

## What proves it

- Server itest on fake provider and device: a sender that arrived before recognition waits for it; frames produce text in the feed; a second sender is refused `sender-refused`; `finish_recognition` waits for the last-frame mark and then ends the sender with a `finished` answer; a `seq` miss yields a closed `Gap transport`, and an end of frames before `finish` an open one; system audio with `at: caller` is refused `track-invalid`; `AudioDevices.capture` is not called for a `caller` track.
- Smoke: iPhone (PWA from the home screen) and Android Chrome over a cellular network and Tailscale. Holding the microphone → text in the agent field. The Mac microphone indicator stays off, the chip says "on a tethered device". Locking the screen mid-dictation → nothing sent, confirmed text in place. Tagma.app and the Mac browser record through the helper, as before.
- A measurement as a sample on the named network: from release to insert over LTE for each of the three recognizers. The stream is 256 kbit/s PCM.
- The socket route is checked by smoke: it only turns the socket into a frame stream, registers it under the device and writes the close code.

## Out of scope

- Voicing on the phone (`speak_text` and the agent's voice). An answer is needed for which device the agent speaks on when the operator moves between the Mac and the phone. That is a separate spec.
- An anti-aliasing filter before downsampling to 16 kHz: averaging over the step window already cuts the bulk, speech above 8 kHz is weak. Add if a measurement shows accuracy loss.
- Opus compression through WebCodecs. Add if 256 kbit/s proves expensive on a mobile network.
- Background recording and a native app.
