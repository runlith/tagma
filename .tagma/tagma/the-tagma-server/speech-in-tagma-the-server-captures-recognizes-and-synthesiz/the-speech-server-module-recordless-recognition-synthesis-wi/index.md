---
id: 01a0ff30-3ce0-7879-8c00-c37bcc1f119c
title: "The `speech` server module: recordless recognition, synthesis with playback, speech keys and settings, capability status with reasons"
ord: 5
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/providers/contract/wire/catalog.ts
---
The `speech` module in `apps/tagma/server/src/speech` is speech as a product on the server. It runs recognition without recording and synthesis with playback, keeps speech settings, and answers what is available and why. Kind is product, with its own manifest of operations, feeds, settings, and boot. Sessions, catalog, and synthesis come from the `Speech` service in `@runlith/speech`; sound comes from the `AudioDevices` port in `@runlith/audio`. The module imports no adapter, no `audio-darwin`, no Whisper engine.

## Composition

- `Speech.layer([speech-soniox, speech-openai, whisper(engine)])` — where composition also lists modules. There it also binds `AudioDevices` (by `process.platform`: `audio-darwin` with the `Tagma.app` path from the install module, otherwise `none`), `SpeechDetector` (engine or `none`), `DuplexTransport`, and the Bun runtime's process service.
- The module fills the `SpeechCredentials` port from `providers`. A new platform is one binding in composition; the `speech` module does not change.

## Keys

- **A speech provider key is a console key in the existing `ConsoleKeyStore`.** `providers/contract/wire/catalog.ts` currently requires console providers to match the model catalog's api-key providers; that link is broken: console providers are the model catalog's api-key providers plus speech provider ids, which composition hands to the module's `providers` port. A speech provider never lands in the model catalog or model choice.
- One id is one key: the `openai` speech provider deliberately shares a console key with OpenAI models. A ChatGPT/Codex OAuth account has nothing to do with speech.
- The key is picked by the existing providers logic: an explicit account, otherwise default. “No key” and “several keys, no default set” are different refusals with their own `unblock`. The key never leaves the server.

## Settings

Default recognizer (provider, model, and turn mode), language, synthesis provider, model and voice, default microphone (this machine's device id), `tuning` numbers of the chosen models, and `Segmenter` thresholds.

## Recognition without recording

The `recognize{tracks: [{source, device?, echoCancel}], recognizer?}` feed serves partials, finals, levels, and track states while its subscriber holds it, and stores nothing. The verification run and future products like dictation use it. The engine sorts out track failures (segments, backoff, attempt limit); a track the engine finished reports its cause in the feed, the rest continue.

## Synthesis

- The `speaking` service gives the server's future products `open → {say, end}` with streaming text over `Speech` and `Player`; closing the scope cancels generation and `release`s the player.
- The `speak_text{text, voice?, model?}` operation takes whole text; `stop_speaking` clears the player and closes synthesis. What products speak, and when, is the products' decision.

## Status

`speech_status` — for the window and the agent: platform capabilities and permission state, each provider's models with availability and reason, helper and engine state, installed local models. Installing and deleting a local model are operations with progress.

## Proof

On fake `AudioDevices`, recognizer, and detector (integration, in-process):
- `recognize` writes nothing to the store;
- no key and an ambiguous default are different refusals with `unblock`; a speech provider key never appears in the model catalog.
