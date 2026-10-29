---
id: 01a0ff30-3ce0-7879-8c00-c37bcc1f119c
title: "The `speech` server module: project listenings and recordless recognition, transcripts for agents, synthesis with playback, speech keys and settings, capability status with reasons"
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
The `speech` module in `apps/tagma/server/src/speech` is speech as a product on the server. It runs listenings (capture → recognition → transcript) and recognition without recording, synthesis with playback, keeps project transcripts and settings, and answers what is available and why. Kind is product, with its own manifest of operations, feeds, tables, settings, and boot. Sessions, catalog, and synthesis come from the `Speech` service in `@runlith/speech`; sound comes from the `AudioDevices` port in `@runlith/audio`. The module imports no adapter, no `audio-darwin`, no Whisper engine.

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

The `recognize{tracks: [{source, device?, echoCancel}], recognizer?}` feed serves partials, finals, levels, and track states while its subscriber holds it, and stores nothing. The verification run and future products like dictation use it, so as not to litter the project transcript.

## Listening

- `start_listening{project, title?, tracks, recognizer?}` → a `live` listening; per track — capture and a recognition session; utterances and gaps are written as they arrive.
- `end_listening{id, mode: finish | stop}`: `finish` drains capture and waits for each track's `Finished` — `completed` only if every track got it, otherwise `interrupted` with an `unconfirmed-tail` gap; `stop` closes the scope at once — `interrupted`.
- A listening belongs to the server, not the window: closing the window does not stop it.
- The engine sorts out track failures (segments, backoff, attempt limit); a track the engine finished reports its cause in the feed, the rest continue.
- **Handoff to a successor.** The Tagma server on update hands its place to a successor itself ([[c7d48051|Tagma on Mac]]). The predecessor interrupts its sessions, leaves the listening `live` with a handoff mark and a gap with a `handoff` cause; the successor on boot continues marked listenings with the same tracks and recognizer. A `live` listening with no mark after start is a crash consequence and becomes `interrupted`.

## Project transcript

A listening belongs to a project, not a thread: it survives the thread and leaves with the project (FK to `project` with `onDelete: 'cascade'`). Tables live in the machine DB.

- **Listening**: project, title, wall-time start as label, its scale's monotonic origin, end on the scale, state (`live`, `completed`, `interrupted`), tracks (id, source, label), recognizer. Continuation by a successor translates time to the same scale through the kept wall-time start.
- **Lines** are utterances and gaps. Utterance: identity `{track, segment, seq}`, revision, text, start and end on the scale, units with time, speaker, and language (one utterance can carry several speakers; then the top speaker is empty). Gap: track, range or unknown boundary, cause. Only the `source` meaning track is stored; partials, translation, and sound are not.
- **Write** is an utterance upsert by identity; each accepted new revision gets the next change number, monotonic within the listening. There is one writer — the server itself.
- Deleting a project stops its listenings.

## Reading

- `list_listenings` — a project's listenings, newest first: state, duration, tracks, utterance count; a page with `limit`, total, and cursor.
- `read_transcript` — lines after a cursor in change order, with `limit`, total, and the next cursor. If there are no lines and the listening is `live`, the call waits for a new line or the end, but no longer than the named wait and the operation ceiling. The answer names the state. A correction arrives as a line with an already-known identity.
- `delete_listening` — a listening with its lines.
- Window feeds: a live listening (partials, levels, track states) and transcript lines.

Meeting speech and machine sound are material for an agent, not the operator's words: they arrive as an operation answer and never enter the system prompt.

## Synthesis

- The `speaking` service gives the server's future products `open → {say, end}` with streaming text over `Speech` and `Player`; closing the scope cancels generation and `release`s the player.
- The `speak_text{text, voice?, model?}` operation takes whole text; `stop_speaking` clears the player and closes synthesis. What products speak, and when, is the products' decision.

## Status

`speech_status` — for the window and the agent: platform capabilities and permission state, each provider's models with availability and reason, helper and engine state, installed local models. Installing and deleting a local model are operations with progress.

## Proof

On fake `AudioDevices`, recognizer, and detector (integration, in-process):
- a listening writes utterances and gaps; a correction reaches the reader under the same identity; two cursors are independent;
- `read_transcript` with a wait wakes on a new line and on listening end;
- `finish` gives `completed` only with `Finished` from all tracks; without it — `interrupted` with a gap; `stop` is `interrupted`;
- a listening with a handoff mark continues on boot; a `live` one with no mark becomes `interrupted`;
- `recognize` writes nothing to the store;
- deleting a project takes its listenings;
- no key and an ambiguous default are different refusals with `unblock`; a speech provider key never appears in the model catalog.
