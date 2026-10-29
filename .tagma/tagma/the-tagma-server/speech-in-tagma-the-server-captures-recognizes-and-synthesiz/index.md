---
id: 01a0ff30-3ce0-7879-8c00-c376b4ee7196
title: "Speech in Tagma: the server captures, recognizes, and synthesizes audio through one speech protocol with provider adapters, and the platform comes from a devices port"
ord: 99
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a104f7-f8d1-7ff5-ad08-d25c58882889
---
Tagma gets speech as infrastructure: microphone and system-audio capture, recognition, synthesis, playback, and a durable project transcript. Products built on it — dictation, talking to an agent, meetings, trainers — are designed in their own specs and are not decided here.

## Decisions

- **Sound is owned by the server.** Capture, recognition, synthesis, and playback run on the server machine. The Tagma window, browser or Electron, never touches audio: it configures, shows, and reads transcripts through operations and feeds. The Electron layer knows nothing about sound.
- **Native sound on macOS is captured and played by a helper inside `Tagma.app`**, opened via LaunchServices. TCC attributes it to the `Tagma.app` permission, whoever started the server ([[c3dad364|TCC research]], [[c7d48051|Tagma on Mac]]).
- **All providers go through one speech protocol**, as all models go through the single `packages/llm` wire. A provider is an adapter declaring the capabilities of each of its models. The core, the server, and the UI choose by capability and never name a vendor: no branching on provider id, no vendor lists outside composition. A missing capability is a declared absence with a reason.
- **The platform is an implementation of the devices port.** Everything above the `AudioDevices` port is OS-independent, and the native helper protocol is neutral. macOS is the first implementation; Windows and Linux later become one more package with a helper speaking the same protocol and one binding in composition, with no changes to the core, adapters, or the `speech` module.
- **Kits do not depend on the runtime.** They receive networking, processes, and channels through ports bound by the host composition: Bun in the server, Node in Electron main.
- **There is one speech detector of our own**: Silero inside the whisper.cpp engine, with boundary decisions made by a pure `Segmenter` in the core. Local Whisper needs it for slicing, as do models where the client sets the turn end (OpenAI `gpt-live-transcribe` requires this per its documentation). Modes with a provider endpoint (Soniox `<end>`, OpenAI `server_vad`) run without it.
- **TTS is played by the helper**, not the window. The goal is to feed playback into the reference of the same VPIO graph as the echo-cancelled microphone and to exclude Tagma's own sound from the system tap by the helper's pid; the window provides neither. That echo cancellation works is confirmed by smoke.

## Why the old stack is replaced

The `audio-*`, `transcription*`, and `tts*` packages were written by past generations of models; two audits (architecture and detail) showed that what survives in them is vendor knowledge and CoreAudio calls, not the frame:
- no shared protocol: vendor options leak to the consumer through generics, the core describes transports instead of capabilities;
- the vendor protocol and the socket life are fused into one class; three TTS packages copy the same socket automaton;
- Promises and callbacks instead of Effect, while the server and `llm` are on Effect;
- capture time never reaches the consumer, and pause and the queue before readiness silently drop sound;
- the helper allocates memory, converts, and writes to stdout on the realtime thread, serves sound in the wrong format on converter failure, and loses the tail on stop;
- `audio-vad` opens the microphone itself and degrades silently.

Old packages are not fixed in place. A new package replaces an old one, and the wave where it lands moves the consumer over and deletes the old one (the “one shape” law). 

## Packages and modules

| Package | Kind | What it owns |
|---|---|---|
| `@runlith/audio` | kit | PCM, track, gap, monotonic time, streaming resampler, the `AudioDevices` and `Player` ports, the neutral helper protocol and its client ([[9d375daf|audio kit]]) |
| `@runlith/audio-darwin` | kit | Swift helper, its launch via LaunchServices and Unix socket ([[acba5047|macOS helper]]) |
| `@runlith/speech` | kit | speech protocol: request and event language, capability dictionary, catalog and choice, adapter contract, duplex runner, recognition and synthesis sessions, `Segmenter`, the `SpeechDetector` and `SpeechCredentials` ports, the `Speech` service ([[d3bd40f5|speech protocol]]) |
| `@runlith/speech-soniox`, `@runlith/speech-openai` | kit | first-delivery adapters, STT and TTS of one vendor in one package ([[9c5ec1b5|adapters]]) |
| `@runlith/speech-whisper` | kit | whisper.cpp engine as a child process: local Whisper and the speech detector, model store ([[ba0fa36e|Whisper engine]]) |
| `speech` in `apps/tagma/server/src/speech` | product | project listenings and transcripts, recognition without recording, synthesis and playback, keys, settings, capability status ([[cc1f119c|server module]]) |

Import direction: adapters and `speech-whisper` → `@runlith/speech` → `@runlith/audio`; `audio-darwin` → `audio`. The `speech` module imports `@runlith/speech` and `@runlith/audio`; composition of the server binds adapters, `audio-darwin`, `speech-whisper`, and the runtime. The window imports no audio packages ([[87eac0a0|window]]).

```
window ──ops/feeds──▶ speech ──▶ Speech (@runlith/speech) ◀─ composition: [speech-soniox, speech-openai, speech-whisper]
                     │            ├─ SpeechDetector ◀─ speech-whisper engine | none(reason)
                     │            └─ SpeechCredentials ◀─ speech (from providers)
                     ├──▶ AudioDevices ◀─ composition: audio-darwin | none(reason)
                     │            └─ socket ─▶ Tagma.app/Contents/Helpers/<helper>.app
                     └─ machine DB: listenings, lines ─▶ list_listenings / read_transcript
```

Every kit Tagma imports gets a `#module` card before its first import; the card is written from the code as read.

## First delivery

- Providers: Soniox and OpenAI (cloud), Whisper (local). ElevenLabs, Deepgram, Cartesia, Google, Amazon, and the rest connect as new adapters; within the event language — no core changes, and a new event shape enters the core as a shared concept together with the first adapter that needs it. Material on them is in [[58882889|provider contract matrix]].
- Platform: macOS. Where there is no helper (a CLI-only install, Linux, Windows, no GUI session), `AudioDevices` answers `absent` with a reason.
- Local Whisper and the detector live where the engine is built; now macOS arm64. Building for other platforms is a build matter, not an architecture one.

## Work order

1. `@runlith/audio` and `@runlith/speech` with fake devices and transport.
2. Soniox and OpenAI adapters, the `speech-whisper` engine.
3. The `audio-darwin` helper and embedding it into `Tagma.app`.
4. The `speech` module and the setup and verification surface in the window.
5. Deletion of the old packages.

Steps 1–2 and 3 are independent and run in parallel.

## Out of scope

- Speech-to-speech models (OpenAI Realtime, Gemini Live): the cascade covers every combination.
- Keeping source audio and re-recognizing the past: the transcript keeps text only.
- Input from a file or URL; selecting a separate app for system sound by bundle id.
- Sound in a remote window: a window on another machine neither hears nor speaks with its own sound. If the product needs it, it adds a window player over the same PCM stream; the synthesis protocol does not change.
- Windows and Linux implementations: the helper port and protocol admit them, but they are not built now.

## Combinations that prove the shape

| Future product | Combination |
|---|---|
| Dictation | microphone → `recognize` → text to the consumer, with no recording |
| Talking to an agent | echo-cancelled microphone → recognition; text → synthesis → player with clearing |
| Meeting, YouTube, machine background sound | microphone and system sound as two tracks → listening → project transcript → agent reads `read_transcript` |

## Proof

- Contract tests owned by the owners — in each child spec.
- Smoke of an installed `Tagma.app` on macOS: microphone and system-sound permissions survive rebuild; frames from both sources without Tagma's own sound; cloud and local recognition; synthesis with echo cancellation without headphones; a listening survives handoff to its successor; no helper processes remain after stop and server death.
- Measurements on the named machine, each as a sample: capture → first partial; end of speech → local Whisper final; synthesis request → first sound; engine memory.
