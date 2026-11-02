---
id: 01a0ff30-3ce0-7879-8c00-c379d3bd40f5
title: "`@runlith/speech`: one speech protocol — model capabilities as data, the vendor protocol as a pure codec, a shared duplex runner, segments and utterances on a scale, `Segmenter`"
ord: 3
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
`@runlith/speech` is the one speech protocol for all providers, after the pattern of `packages/llm`: a neutral request and event language, model capabilities as data, the vendor protocol as a pure codec, transport behind a port, a shared session engine, and a `Speech` service any host uses — the Tagma server. It replaces `transcription` and `tts`. The core names no vendor and does not depend on the runtime: it receives networking, processes, and sockets through ports filled by the host composition (Bun in the server, Node in Electron main).

## What moves over from `llm`, what does not

The split moves over, not the code: neutral language, the protocol `step` automaton, transport behind a port, a catalog with build-time verification, a typed refusal for a missing capability, credentials as a product port, one service per process. Not moving: the “request → response” model with retry (sent sound cannot be repeated), `Route.with`, deployment profiles, OAuth, vendor lists inside the package. `@runlith/llm` is not imported.

## Package by floors

- `wire/` — requests, events, `SpeechFailure`, capability dictionary.
- `protocol/` — adapter contract, `SpeechProtocol`, the `DuplexTransport` port, duplex runner.
- `engine/` — catalog and choice, recognition sessions (segments, scale, utterances, `Segmenter`), synthesis, the `SpeechDetector` and `SpeechCredentials` ports, the `Speech` service.
- `testing` entry — `ScriptedTransport`, fake recognizer, synthesizer, and detector.

## Ports and service

- `Speech.layer(providers)` builds the catalog, sessions, and synthesis from a provider list. The host composition supplies the list; a new vendor is a new package and one line there.
- `SpeechCredentials` is `(provider, account?) → credential` or a typed refusal. The engine requests credentials when opening each connection, not once per session: a key can change while sessions run for hours. The server fills the port from console keys.
- `SpeechDetector` is a per-track windowed speech-probability stream with its own state; [[ba0fa36e|the whisper.cpp engine]] fills it, or composition gives `none(reason)`.
- `DuplexTransport.open({url, headers, protocols})` → `send(text | bytes)` with admission, `messages`, `close`. The host runtime provides the implementation with authorization headers; the standard WHATWG WebSocket carries no headers, so it is not a server implementation.

## Model capabilities

Capabilities are declared per model: one vendor's differ (OpenAI `gpt-live-transcribe` has neither word timestamps nor speakers, and the client sets the turn end). A capability is what a model can do; availability is whether it can run here and now (key present, model downloaded, engine built), with a reason and `unblock`.

Recognition:
- `kind: stream | batch` — batch together with a detector gives a stream in segments;
- `input.rates` — rates into one of which the core resamples;
- `partials`;
- `turns` — the **set** of supported turn-end modes: `provider` (provider endpoint), `client` (our detector finds the end of speech and sends `commit`), `none` (the provider does not mark turns, the core assembles utterances). The mode is chosen by the neutral request field `request.turns`; the catalog checks that the mode is declared, that a detector exists for `client`, and that `none` is allowed only with `timestamps: word` or together with a detector;
- `finalize` — force-fix the open tail;
- `timestamps: word | segment | none`; `speakers`; `confidence`;
- `languages` — codes, number of hints, auto-detection; `detect` in a request means “name the language of each unit” and never “drop the hints”: the engine asks every capable model for it, with or without hints, and an adapter that cannot do both at once (Whisper) takes the first hint as the recognition language and puts it on the units;
- `translation` — targets and two-way mode;
- `context` — prompt, term dictionary;
- `limits` — session duration, clip length and size;
- `tuning` — a number schema inside the mode (endpoint sensitivity, delay): visible in settings, opaque to the core, never switching modes.

Synthesis: `text: stream | whole` (for `whole` the core accumulates text to the end, the consumer does not branch), output rates, voices, languages and whether the language is required in the request (then `choose` does not pick a model for a languageless request), timestamps (then `Synthesis` returns them next to the sound), limits — characters per message, sound duration per request, concurrent streams.

A provider declares `id`, a label, a credential shape (Effect Schema: `{apiKey}` for most, different for Amazon and Google, `none` for Whisper), models with capabilities, a recognizer and a synthesizer, availability, and egress origins.

## Catalog and choice

`speechCatalog(providers)` verifies id uniqueness and capability consistency at build time and throws, like `modelCatalog` in `llm`. `choose(need)` answers by `kind`, turn mode, partials, speakers, marks, language, and translation with a choice or `NoModel` with a reason per candidate. An explicitly chosen operator model goes through the same check. No fallback: an unavailable local recognizer does not send sound to the cloud.

## Event language

Vendors speak of “finality” differently: a hypothesis replaced by token, segment, turn, or sound range; delta or cumulative; token, segment, or turn finality; different turns' completions out of order ([[58882889|contract matrix]]). The adapter reduces its shape to one model, and there is no single `isFinal` flag in it.

Each turn has a **stable prefix** and a **replaceable hypothesis**. Every event carries an opaque turn key `turn` given by the adapter (`item_id` at OpenAI, the turn number between `<end>` at Soniox):
- `Partial{turn, text}` — a new hypothesis of the turn after the stable prefix; replaces the previous hypothesis whole;
- `Final{turn, units}` — stable text appended to the turn's prefix; the hypothesis before it is withdrawn;
- `TurnEnd{turn}` — the turn is over; only this closes an utterance successfully;
- `TurnFailed{turn, message}` — the provider did not recognize the turn; the core closes the utterance with a gap over the turn's range;
- `SpeechStart{turn, at}`, `SpeechEnd{turn, at}` — acoustic turn boundaries, if the provider gives them;
- `Committed{turn, commit}` — the provider bound the turn to our `commit` (`client` mode);
- `Finalized` — confirmation of forced finalization;
- `Finished` — the provider proved all accepted sound is processed and no more events will come.

`units` are text units with explicit granularity (`token | word | segment`): time, if the model gives it; speaker; language; meaning track `lane: source | translation` with the source language. Translation has no time of its own. A word is assembled only where the provider set the boundary; grouping by speaker never loses unit times.

## Adapter contract

- `Recognizer.stream(model, request, credential)` → in scope `Connection{format, send(pcm), commit, finalize, finish, events, delivered}`; event times are the provider's samples from connection start; `delivered` is how many samples actually reached the network. A break, overflow, or stop without `Finished` closes the segment as interrupted with a gap from the end of the last confirmed result to the end of the sound handed to this connection: sent-but-unrecognized sound is also loss.
- `Recognizer.batch(model, clip, request, credential)` → events with time from the clip start.
- `Synthesizer.open(model, request, credential)` → in scope `Synthesis{format, say(text), end, audio}`; the format is fixed at open, `audio` yields whole samples only, and after scope close — not one chunk.

Most adapters do not write `Connection` by hand: they give a pure `SpeechProtocol` — opening frames (URL, headers, init), `ready(state)` — the moment the provider accepts sound (after init confirmation, not at socket open), `audio(pcm) → frame`, `commit`, `finalize`, `finish`, keepalive, incoming-frame codec, `initial`, `step(state, frame) → [state, events]`, `terminal`. The shared runner `duplex(protocol, transport)` makes it a `Connection`, `synthesisDuplex` a `Synthesis` — one socket automaton instead of a copy in each adapter.

The runner:
- sends sound only after `ready`; `stop` during auth or init closes the same scope and leaves no late-opened connection;
- holds a shared budget of sound accepted but not yet sent to the network (pre-readiness queue plus transport buffer together); overrun ends the segment with a gap over the unaccepted sound;
- emits `Finished` only on the provider's own condition (Soniox — `finished` after an empty frame; OpenAI — every confirmed `commit` got `completed` or `failed`). An empty result with no speech is a normal `Finished`. A wait timeout is an `unconfirmed-tail` refusal, never `Finished`.

`SpeechFailure` is tagged: `auth`, `rate` (with `retryAfter`), `invalid-request`, `transport`, `provider`, `unsupported`, `unconfirmed-tail`, with a retryable mark; a refusal is distinct from a break.

## Streaming recognition

1. A `Track` with the format from readiness; a resampler brings it to the connection format.
2. **Session scale** — milliseconds from the monotonic origin set by the host (the capture start at the server). The session keeps a “sent-sample-index → capture-time” mapping built from chunk times, and translates provider time through it. Device clock drift therefore needs no thresholds and no rebinding.
3. **Segment** — one connection over continuous sound. It opens on the first chunk after start or a gap; a gap or break closes it as interrupted. Provider speakers hold within a segment: no speaker matching across segments.
4. Before `ready` sound waits in the runner's shared budget; overrun is a gap. Sound is never dropped silently, and there is no pause.
5. In `client` mode the `Segmenter` over `SpeechDetector` probabilities sends `commit` on end of speech and on the length limit; each commit carries a sound range, and a late result gets its commit's time, not the current turn's.
6. **Utterance** is the provider's turn. Identity is `{track, segment, seq}`; the core assigns `seq` in turn-opening order (in `client` mode — in commit order), with no reset across segments. The core holds several turns open at once: different turns' completions can arrive out of order. Utterance time comes from text units, otherwise from the turn's `SpeechStart`/`SpeechEnd`, otherwise from the commit range.
7. In `none` mode and for overly long speech the core itself closes the utterance on speaker change, pause between words, and the length limit — the same for all adapters.
8. **Reconnect** after a break or retryable refusal uses exponential backoff with a cap, honoring `retryAfter`; sound over the wait is a gap with a cause. After several failures in a row the track ends with a reason. `auth` and `invalid-request` refusals end it at once.
9. **Provider session limit** is a planned changeover with no overlap: the new connection opens ahead, the switch happens on a turn boundary (`TurnEnd` or end of speech per `Segmenter`), sound after the boundary goes to the new connection, the old one drains to `Finished`. One sound range never goes into two connections.
10. A session closes two ways: **finish** — the track is drained, `finish`, waiting for `Finished`; without it in time the tail is a gap with an `unconfirmed-tail` cause; **stop** — scope closes at once, no tail waited for.

## Segmented recognition

Track → `Segmenter` → `Clip{from, to, pcm}` → a sound-duration-bounded queue (overflow is a gap) → `batch(clip)` → events with time `clip.from + t`. This is how local Whisper works; the core will assemble a stream out of any future HTTP model the same way, the adapter does not do it.

## Segmenter

A pure automaton over windowed speech probabilities: hysteresis thresholds, minimum speech and silence, pre-roll, length limit, `flush` at track end. On a gap both the `Segmenter` and this track's detector state reset. Values are settings with defaults chosen by measurement.

## Synthesis

`synthesize(choice, request)` → `Synthesis`; the host routes `audio` into the devices port's `Player`. Cancellation is scope close. Cancelling generation at the vendor, flushing, and stopping audible sound are different acts: the core closes generation, `Player.clear` stops the sounding.

## Extension

A new adapter connects within this event language with no core changes. Known shapes missing from the first delivery — early turn end with rollback (Deepgram Flux, Cartesia), speaker revision after final (AssemblyAI), sound-range replacement (Apple) — enter the core as shared event-language concepts together with the first adapter that needs them, never as a vendor branch.

## Proof

Tests through the public `Speech` service on a fake recognizer and synthetic tracks (unit):
- several `Final` and `Partial` of one turn, then `TurnEnd`, give one utterance with no doubles and no losses;
- `B.completed` before `A.completed` with an open `C.partial`: order, time, and identity of all three preserved;
- pre-`ready` sound arrives; over-budget gives a gap; a gap closes the segment and opens a new one; identity never repeats across segments;
- `finish` waits for `Finished`, and without it in time gives `unconfirmed-tail`; `stop` before `ready` leaves no connection;
- reconnect honors backoff and `retryAfter` and ends the track after the limit; `auth` ends at once;
- changeover at the session limit never sends one range into two connections.

Also: `Segmenter` on scripted probabilities (a short utterance and the tail are not lost, the length limit cuts, reset on a gap); the runner on `ScriptedTransport` (opening frames per request, sound only after `ready`, vendor refusal as a typed `SpeechFailure`); the catalog (inconsistent capabilities throw at build, `choose` explains each rejected candidate).
