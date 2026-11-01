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
- Speech's manifest declares seven `speech.calls.*` keys beside its other keys. A key's section is its id's first segment (`platform/contract/wire/setting.ts`), so a key of any module named `speech.*` already lands in speech's section. `nativeOffers` (`invocation/nativeDoor.ts`) already groups every assembled operation by `tool.capability`, whatever module declares it.
- Store: seven machine-store tables. Four are entities (`listening`, `listening_speaker`, `listening_follower`, `listening_given`), three are history (`transcript_line`, `transcript_entry`, `transcript_staged`), and `transcript_fts` indexes them. They come from migrations `baseline`, `calls` and `listening_echo`. Three machine-store facts tie them there:
  - `listening.project_id` cascades from `project`, and search joins `project` for names (`speech/store/matches.ts`);
  - speech's `HOME_FOLLOWERS` item rewrites `listening_follower` inside the machine write unit of a thread move (`thread-record/contract/service/homes.ts`);
  - search indexes only listenings marked `indexed = false` (`speech/store/entries.ts`).

  Audio lies under `<data>/recordings`, carried by speech's `RELOCATIONS` item.
- The data directory's owners carry only what they know:
  - The transition attempt copies the databases standing directly under `<data>/stores/` (`installation/process/trial.ts`). A store a failed start creates afterwards stays as it was left.
  - A world transfer copies the machine database and the paths the target build's `RELOCATIONS` items name (`installation/move/transfer.ts`). It carries no module store.
- An extension module's installation lifetime is built over `ServerRuntime.runtime` (`composition/build.ts`, `composition/runtime.ts`), which offers neither `Speech`, `AudioDevices`, `Settings`, `Projects`, `ProjectChanges` nor speech's capture registry. Composition binds speech's own implementations inside the core assembly.
- Composition fills speech's ports by hand:
  - `CallThreads` in `composition/callThreads.ts`, bound once the threads stack stands;
  - `RecordingsPlace`;
  - `Echo`, through an `import()` of `@runlith/echo/sonora` in `composition/speech.ts`;
  - `Handoff`.

  It also reads `Listenings.live` into the installation's `MachineCalls`. `read_machine_state` answers that count as the required `server.calls`, which the CLI decodes whole (`installation/cli/server.ts`) and the desktop's busy check and quit words read (`desktop/src/server.ts`, `desktop/src/quitting.ts`).
- The HTTP door's fixed `Api.groups` include `SpeechGroup` (`http/contract/wire/speech.ts`): audio and peaks of a listening track, served by `composition/http/speech.ts`. `composition/http/handlers.ts` lists `Listenings` in its context.
- Listenings are the only consumer of `@runlith/echo` and `@runlith/audio-file`. The kit's recorded-file road (`Speech.transcribe`, `resume`, `discard`, the `recorded` batch road) and the file models the adapters declare are reached only from re-recognition. The native helper's system-audio tap (`packages/audio-darwin`, `SystemTap`) also serves the check and any capture.
- The app-view bridge `tagma/speech` carries `listening` and `transcript` actions beside recognition and speech output. They stand in `speech/contract/wire/view.ts`, the client's `features/speech/viewSpeech.ts` and the skill reference `native-harness/skills/apps/references/speech.md`.

App:
- `app/chrome/TopBar.svelte` draws `CaptureChip` and `CallChip` and opens the call pane. `app/chrome/Shell.svelte` draws `CallKeys`. `app/composition.ts` provides `CallScreen` over `ThreadOnScreen`.
- `features/threads/Draft.svelte.ts` holds `pieces: Piece[]`, typed by speech's wire. `DraftStore.ts` stores them without a kind. At send, `threads/native/CallPieces.ts` resolves them through `ThreadsRepo.pieceText` and `givePiece`, which call `read_transcript_text` and `give_transcript_piece`. `draft.composer.svelte` draws `PieceCards`.
- `features/speech/Section.svelte` draws the "Calls" `KeyCard`, `CallSound` and `CallAgain` inline. `SettingsPage.svelte` already draws every section's `SectionContributions` after the section's own view.
- A core route file `routes/[project]/calls/[[id]]` stands beside the `calls` surface. Links to a moment are issued under it, with `at` and `word` in the query (`features/speech/library/place.ts`).
- `CaptureChip` counts `listening` captures by that literal, and `Captures.svelte.ts` stops them with `end_listening`.

Dictation (`features/speech/dictation/`), the check, speaking, local models, devices and status import nothing from `calls/` or `library/`.

## What will stand

The speech module keeps:
- recording-free recognition: dictation into an agent field, the terminal and any app, device dictation, the check and a view's recognition;
- synthesis and playback, local models, status and speech settings;
- the `speech` agent capability.

It holds no listening, transcript or recording state, and imports neither `@runlith/echo` nor `@runlith/audio-file`. The kit keeps its recorded-file road and the adapters their file models: they are part of the speech protocol, not of any product. A module from any root that records and keeps captures — a *keeping module* here — reaches speech, the window, threads and the machine only through the points below. With none, each point is empty.

**Order.** Each point lands beside today's code, which keeps working as it is. The code it replaces — `Listenings`' kept-capture members, `CallThreads`, `RecordingsPlace`, `Echo`, `Handoff`, `MachineCalls`, `SpeechGroup`, `CallScreen`, `Draft.pieces` and the inline settings cards — goes in the change that moves its last consumer onto the point.

Server:
1. **A recognition service and a capture kit.** A recognition service with `recognize`, `finish` and `send` takes recording-free recognition out of `Listenings`.
   - The capture registry becomes a service of its own, `Captures`. Its entries carry an owner-named `kind`, a noun for the chip, and the stop their owner registers.
   - Speech's card declares an entry exporting the track chain (`named`, `capture`, `listened`, `recognized`), live and recorded-file recognizer choice and utterance conversion. The recorded-file choice takes its pick as an argument instead of reading a key.
   - The muting gate leaves `track.ts`, and `listened` takes no muting.
2. **One stop for any capture.** An operator operation stops one capture by kind and id, or all of them, through the stop each owner registered; the capture chip calls it. `finish_recognition` stays for dictation's confirmed tail.
3. **Wire without kept-capture types.**
   - `Heard` loses `listing`, and its `state` takes a recognition state of its own.
   - A capture's `kind` is an owner-named string.
   - `ModelStatus.recorded` is added, answering what `again` answers: the model hears a recorded file. `again` stays, with the same value, for clients of earlier releases.
   - What a keeping module needs from speech's wire — track and recognizer asks, turn mode, `Heard`, `Recognizer` — is reached through a declared entry.
4. **The shared owners reach extension lifetimes.** The context an extension's installation lifetime is built over, and its checked type, offer:
   - `Speech`, `AudioDevices`, `Settings`, `Projects`, `ProjectChanges` and `Captures`, the same instances the core uses;
   - succession's `leaving` and `opened`, which speech takes today as `Handoff`.

   A serving-tier extension lifetime reaches what a server-side producer needs to put a keyed message with a document into a thread and withdraw it: queueing and unqueueing a keyed input, uploading an attachment, and a thread's project.
5. **A module's files directory.** Each module with a store gets `<data>/stores/<id>/` for its files. The transition attempt leaves it untouched, as it leaves module files today. A world transfer and data-directory relocation carry the whole `<data>/stores/` tree — every store, every files directory and every set-aside — whether or not the build declares their owners.
6. **Module routes carry parameters, ranges and a right.** The manifest routes of [[03cec1d8]] — exact GET paths a module declares, joined into the door generically — take path parameters and request headers such as `Range`, so a module serves a file by id under its own prefix, and a route may name a `right`, admitted as a read by `admitRight` before its handler runs. No second route mechanism stands beside them. `/api/speech/send` stays speech's.
7. **Live work a stop ends.** Installation declares a point whose items give a count and its words for one and for many.
   - `read_machine_state` answers the items as an optional list beside `server.calls`. `server.calls` keeps its shape, answered as the total of the items, so a CLI or desktop of an earlier release still decodes the answer.
   - The desktop's busy check and quit words read the list when it stands, and `calls` otherwise.
8. **Tables leave the machine store with their rows.** A machine-store migration that removes tables may set them aside.
   - The migration writes their rows into `<data>/stores/set-aside/<migration>.sqlite` through a temporary file renamed into place, replacing any file of that name. A start that ran the migration and was then rolled back leaves the file behind, and the start after it writes it again, whole.
   - A module store declares the set-aside it adopts. Adoption runs only after the local door opens, when no rollback can follow. It inserts by the rows' own keys, so an adoption interrupted at any step and run again neither repeats nor loses a row. It deletes the file only once its own write committed.
   - A set-aside nobody adopts stays where it is.

   The core loses no row a removed table held, whichever version a machine updates from.

App:

9. **Window parts.** `app/chrome` declares two points:
   - a top-bar point, drawn after `CaptureChip`;
   - a window point, for parts with no place of their own, such as key handlers.

   Items of both may name `right?` and `offer?`, or neither. An ungated item draws whatever the right answers. `TopBar` and `Shell` then name no speech part beyond `CaptureChip` and dictation's.
10. **Draft attachments by kind.** Threads declares a point of draft attachment kinds `{ kind, card, file(item) → File | null, sent?(item, thread) }`.
    - `Draft` stores staged items with their kind. At send it resolves each through its kind, and calls `sent` once the thread accepted the message.
    - A restored draft drops an item whose kind the build lacks, and so do items stored by an earlier release with no kind. Both are window-local: what such an item referred to stays with its owner.
    - Threads exports a port that stages an item into the on-screen draft and sends it (today `CallScreen`), and fills it from `ThreadOnScreen`.
11. **Former routes of a contributed surface.** A surface may declare the routes it answered before. The window sends an address under a former route to the surface's `p/` address, keeping the rest of the path and the query.
12. **View bridge methods are a point.** The view host declares a point of `tagma/<name>` methods with their notifications. `tagma/speech` keeps `status`, `recognize`, `finish`, `unsubscribe`, `speak` and `silence`, and the apps skill reference documents only those.
13. **The capture chip** counts captures under their nouns and stops them through item 2.

Speech's settings section needs no new point: `SettingsPage.svelte` already draws its contributions, so `Section.svelte` keeps only speech's own cards.

## Invariants

- Speech, chrome, threads, installation, the HTTP door and composition name no keeping module: no import, kind literal, setting key or operation id of one.
- `CORE_MODULES` alone keep today's behaviour for dictation (field, terminal, global and device), the check, speaking, local models and status.
- A build without a keeping module opens a data directory one wrote, and serves its own operations. It reads, migrates and deletes none of the module's store, files directory, set-aside or setting values.
- Window-local state that names what a build lacks — a staged draft item of an unknown kind, a tab of an undeclared kind — is dropped when the window next writes that state, as an undeclared tab already is.
- A test module or a core contributor in this repository exercises every point, so a core change that breaks one fails here.

## Acceptance

- A test module, composed with the core in `composition/testing`, reaches speech only through declared entries and the extension context of item 4, and uses that context's real services:
  - captures a synthetic mic track with the track chain and registers a capture of its own kind, which the stop operation ends;
  - adds a `speech.*` key that `read_settings` lists in speech's section;
  - declares an operation on the speech capability, which an agent carrying the capability is offered;
  - serves an HTTP group under `/api/<id>/`, refused `right-missing` when `Access` answers `none`;
  - adds a live-work count that `read_machine_state` lists, while `server.calls` answers the total;
  - adopts the set-aside of a test table that a test machine migration removed, with every row. Each step is checked: a rollback after the migration, re-entry, an adoption interrupted before and after its commit, and a version skip over the release that set the table aside;
  - keeps a file in its files directory that a world transfer carries, both with and without the module in the target build;
  - reads a thread's home through the thread owners from its serving lifetime. The test world signs in no model and so creates no thread; a keyed delivery is proved by the delivering module's own test.
- A build without that module opens the same data directory and serves, leaving the module's store, files directory and set-aside in place.
- An old CLI decodes the new `read_machine_state`, and the new desktop judges an old server's answer busy or idle.
- App tests: a test layer contributes a top-bar part, a window part, a draft attachment kind, a view bridge method and a surface with a former route.
  - Each contribution is drawn exactly once.
  - The kind's card is drawn, `file` is resolved at send, and `sent` is called after acceptance. An item of an unknown kind and an item stored without a kind are dropped on restore.
  - A gated top-bar part draws its offer when `Access` answers `none`, and an ungated part still draws.
  - An address under the former route, with a query, opens the surface at that place.
  - The core alone draws none of them, with no gaps.
- The capture chip shows a recognition and a test capture under their nouns, and its Stop ends both.
- Speech's dictation, recognition, check, speaking, models and status tests pass, and so does typecheck.
