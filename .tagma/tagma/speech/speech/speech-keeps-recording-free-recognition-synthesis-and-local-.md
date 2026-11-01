---
id: 01a1956f-d780-7c1a-8b6f-809c556ba27b
title: Speech keeps recording-free recognition, synthesis and local models; a module that keeps captures joins speech, the window, threads and the machine at declared points
ord: 26
tags: ["spec"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a19371-bc70-7ecd-b2c5-96b9f492b72c
sources:
  - kind: dir
    ref: apps/tagma/server/src/speech
  - kind: dir
    ref: apps/tagma/app/src/lib/features/speech
---
Paths under `apps/tagma/server/src/` and `apps/tagma/app/src/` unless stated. Read against the code on 2026-11-01. This is the next capability woven through core flows to become points at its owners under [[f492b72c]], after the stealth repository's remote side ([[e41dca93]]).

## What stands

Server:
- One `Listenings` service (`speech/contract/service/listenings.ts`) carries two roads. Recording-free recognition — dictation, the check, a view's recognition, device sending — uses `recognize`, `finishRecognition`, `send` and `captures`. Kept listenings use the other twenty members: start and end, shelf, search, read, mute, mark, name, pieces, give, text, detail, describe, follow, again, remove, recording files, watch, transcript and `live`. `speechLayer` builds the booth, re-recognition, the follower, the audio sweep, search indexing and the orphan sweep beside the hearings.
- Recording-free recognition (`speech/listening/hearing.ts`) shares five files with listenings: the capture registry (`captures.ts`), recognizer choice (`choice.ts`), utterance conversion (`convert.ts`), device sending (`sending.ts`) and the track chain (`track.ts`: `named`, `capture`, `listened`, `recognized`). None of these imports the listening store. Two of them carry listening-only parts: `track.ts` holds the muting gate, and `choice.ts` reads `speech.calls.again` for the recorded-file choice.
- The shared wire mixes the roads. `Heard`, the recognize feed's event, includes `listing` with a whole `Listening` and states typed `ListeningState`. `CaptureKind` is the literal pair `listening | recognition`. `ModelStatus.again` marks a model that can hear a recording.
- Speech's manifest declares seven `speech.calls.*` keys in its one section, beside the recognizer, dictation, voice, language, microphone, tuning and segmenter keys.
- Store: seven machine-store tables. Four are entities (`listening`, `listening_speaker`, `listening_follower`, `listening_given`), three are history (`transcript_line`, `transcript_entry`, `transcript_staged`), and `transcript_fts` indexes them. They come from migrations `baseline`, `calls` and `listening_echo`. Audio lies under `<data>/recordings`; speech's `RELOCATIONS` item carries it, and its `HOME_FOLLOWERS` item follows thread moves.
- Composition fills speech's ports by hand:
  - `CallThreads` in `composition/callThreads.ts`, bound once the threads stack stands;
  - `RecordingsPlace`;
  - `Echo`, through an `import()` of `@runlith/echo/sonora` in `composition/speech.ts`;
  - `Handoff`.

  It also reads `Listenings.live` into the installation's `MachineCalls`. `read_machine_state` answers that count as `server.calls`, and the desktop's busy check (`desktop/src/server.ts`) and quit words (`desktop/src/quitting.ts`) read it.
- The HTTP door's fixed `Api.groups` include `SpeechGroup` (`http/contract/wire/speech.ts`): audio and peaks of a listening track, served by `composition/http/speech.ts`. `composition/http/handlers.ts` lists `Listenings` in its context.
- Listenings are the only consumer of `@runlith/echo` and `@runlith/audio-file`. The kit's recorded-file road (`Speech.transcribe`, `resume`, `discard`, the `recorded` batch road) and the file models the adapters declare are reached only from re-recognition. The native helper's system-audio tap (`packages/audio-darwin`, `SystemTap`) also serves the check and any capture.
- The app-view bridge `tagma/speech` carries `listening` and `transcript` actions beside recognition and speech output. They stand in `speech/contract/wire/view.ts`, the client's `features/speech/viewSpeech.ts` and the skill reference `native-harness/skills/apps/references/speech.md`.

App:
- `app/chrome/TopBar.svelte` draws `CaptureChip` and `CallChip` and opens the call pane. `app/chrome/Shell.svelte` draws `CallKeys`. `app/composition.ts` provides `CallScreen` over `ThreadOnScreen`.
- `features/threads/Draft.svelte.ts` holds `pieces: Piece[]`, typed by speech's wire. At send, `threads/native/CallPieces.ts` resolves them through `ThreadsRepo.pieceText` and `givePiece`, which call `read_transcript_text` and `give_transcript_piece`. `draft.composer.svelte` draws `PieceCards`.
- `features/speech/Section.svelte` draws the "Calls" `KeyCard`, `CallSound` and `CallAgain` inline, not through `SectionContributions`.
- A core route file `routes/[project]/calls/[[id]]` stands beside the `calls` surface.
- `CaptureChip` counts `listening` captures by that literal, and `Captures.svelte.ts` stops them with `end_listening`.

Dictation (`features/speech/dictation/`), the check, speaking, local models, devices and status import nothing from `calls/` or `library/`.

## What will stand

The speech module keeps:
- recording-free recognition: dictation into an agent field, the terminal and any app, device dictation, the check and a view's recognition;
- synthesis and playback, local models, status and speech settings;
- the `speech` agent capability.

It holds no listening, transcript or recording state, and imports neither `@runlith/echo` nor `@runlith/audio-file`. The kit keeps its recorded-file road and the adapters their file models: they are part of the speech protocol, not of any product. A module from any root that records and keeps captures — a *keeping module* here — reaches speech, the window, threads and the machine only through the points below. With none, each point is empty.

Server:
1. **A recognition service and a capture kit.** A recognition service with `recognize`, `finish` and `send` takes the place of `Listenings`.
   - The capture registry becomes a service of its own, `Captures`. Its entries carry an owner-named `kind`, a noun for the chip, and the stop their owner registers.
   - Speech's card declares an entry exporting the track chain (`named`, `capture`, `listened`, `recognized`), live and recorded-file recognizer choice, utterance conversion and `Captures`. A keeping module then captures, meters, recognizes and registers exactly as dictation does.
   - The muting gate leaves `track.ts`, and `listened` takes no muting. The recorded-file choice takes its pick as an argument instead of reading a key.
2. **One stop for any capture.** An operator operation stops one capture by kind and id, or all of them, through the stop each owner registered; the capture chip calls it. `finish_recognition` stays for dictation's confirmed tail.
3. **Wire without kept-capture types.**
   - `Heard` loses `listing`, and its `state` takes a recognition state of its own.
   - A capture's `kind` is an owner-named string.
   - `ModelStatus.again` becomes `recorded`: the model hears a recorded file.
   - What a keeping module needs from speech's wire — track and recognizer asks, turn mode, `Heard`, `Recognizer` — is reached through a declared entry.
4. **Keys into speech's section.** A setting key another module declares may name speech's section, and the catalog lists it there.
5. **The speech capability takes other modules' operations.** An operation of another module that names `tool: { capability: 'speech' }` reaches every agent carrying the capability, with no agent definition changed.
6. **What an extension lifetime reaches.**
   - Every extension installation lifetime reaches succession's `leaving` and `opened` (today `Handoff`, filled for speech alone), and the data directory, so a module keeps files beside its store and contributes `RELOCATIONS` items for them.
   - A serving-tier extension lifetime reaches what a server-side producer needs to put a keyed message with a document into a thread and withdraw it: queueing and unqueueing a keyed input, uploading an attachment, and a thread's project.
   - Speech's `CallThreads`, `RecordingsPlace` and `Echo` ports, and the composition code filling them, leave with their consumers.
7. **HTTP route groups from manifests.** A manifest may contribute an `HttpApiGroup` with its handlers. The door mounts it under `/api/<module id>/`. A group naming a `right` is admitted as a read by `admitRight` before its handler runs. `Api.groups` keeps only the core's own groups, and `/api/speech/send` stays speech's.
8. **Live work a stop ends.** Installation declares a point whose items give a count and its words for one and for many. `read_machine_state` answers the items as a list in place of `server.calls`, and the desktop's busy check and quit words read that list. `MachineCalls` goes.
9. **Tables leave the machine store with their rows.** A machine-store migration that removes tables may set them aside:
   - their rows go into `<data>/stores/set-aside/<migration>.sqlite` in the same transition, and the transition attempt carries the file like module stores;
   - a module store declares the set-aside it adopts; on the store's first open, composition moves those rows into the store's own chain and deletes the file;
   - a set-aside nobody adopts stays untouched.

   The core loses no data a removed table held, whichever version a machine updates from.

App:

10. **Window parts.** `app/chrome` declares two points: a top-bar point drawn after `CaptureChip`, and a window point for parts with no place of their own, such as key handlers. Both admit `right?` and `offer?`: the top bar draws a write, the window a read. `TopBar` and `Shell` then name no speech part beyond `CaptureChip` and dictation's.
11. **Draft attachments by kind.** Threads declares a point of draft attachment kinds `{ kind, card, file(item) → File | null, sent?(item, thread) }`.
    - `Draft` keeps staged items by kind. At send it resolves each through its kind, and calls `sent` once the thread accepted the message.
    - A restored draft drops an item whose kind the build lacks.
    - Threads exports a port that stages an item into the on-screen draft and sends it (today `CallScreen`), and fills it from `ThreadOnScreen`.
    - `Draft.pieces`, `CallPieces`, `PieceCards` and `ThreadsRepo.pieceText`/`givePiece` leave threads.
12. **Speech settings draw contributions.** `Section.svelte` draws speech's `SectionContributions` through `PointView` after its own cards, and draws no card of another module.
13. **View bridge methods are a point.** The view host declares a point of `tagma/<name>` methods with their notifications. `tagma/speech` keeps `status`, `recognize`, `finish`, `unsubscribe`, `speak` and `silence`, and the apps skill reference documents only those.
14. **The capture chip** counts captures under their nouns and stops them through item 2.

## Invariants

- Speech, chrome, threads, installation, the HTTP door and composition name no keeping module: no import, kind literal, setting key or operation id of one.
- `CORE_MODULES` alone keep today's behaviour for dictation (field, terminal, global and device), the check, speaking, local models and status.
- A data directory a keeping module wrote opens, and the core serves its own operations. That covers its store, a set-aside file, `<data>/recordings`, values of its setting keys, a draft holding its attachments and a layout with its tab. The core reads none of these files and deletes none.
- A test module or a core contributor in this repository exercises every point, so a core change that breaks one fails here.

## Acceptance

- A test module, composed with the core in `composition/testing` and reaching speech only through declared entries:
  - captures a synthetic mic track with the track chain and registers a capture of its own kind, which the stop operation ends;
  - adds a key that `read_settings` lists in speech's section;
  - declares an operation on the speech capability, which an agent carrying the capability is offered;
  - serves an HTTP group under `/api/<id>/`, refused `right-missing` when `Access` answers `none`;
  - adds a live-work count that `read_machine_state` lists;
  - adopts the set-aside of a test table a test machine migration removed, with every row;
  - puts a keyed message with a document into a thread from its serving lifetime, and withdraws it.
- A build without that module opens the same data directory, serves, and leaves the set-aside file in place.
- App tests: a test layer contributes a top-bar part, a window part, a draft attachment kind, a speech settings card and a view bridge method.
  - The card is drawn, `file` is resolved at send, `sent` is called after acceptance, and an unknown kind is dropped on restore.
  - A gated top-bar part draws its offer when `Access` answers `none`.
  - The core alone draws none of them, with no gaps.
- The capture chip shows a recognition and a test capture under their nouns, and its Stop ends both.
- Speech's dictation, recognition, check, speaking, models and status tests pass, and so does typecheck.
