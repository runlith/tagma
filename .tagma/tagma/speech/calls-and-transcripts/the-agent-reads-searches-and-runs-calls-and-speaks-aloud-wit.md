---
id: 01a14c08-619e-7ae1-af8b-16d5ed8a107b
title: The agent reads, searches, and runs calls and speaks aloud with its speech tools
ord: 5
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c08-619e-7ae1-af8b-16c8362f480f
  - kind: relates
    to: 01a14c08-619e-7ae1-af8b-16cedb791342
  - kind: relates
    to: 01a14c08-619e-7ae1-af8b-16d0312bb7f6
sources:
  - kind: file
    ref: apps/tagma/server/src/speech/contract/wire/capability.ts
  - kind: file
    ref: apps/tagma/server/src/calls/listening/page.ts
  - kind: file
    ref: apps/tagma/server/src/speech/operations.ts
  - kind: symbol
    ref: apps/tagma/server/src/speech/contract/wire/operations.ts
    symbol: LISTENING_OPERATIONS
---
**Value.** The agent itself works with calls and voice: reads past conversations, searches them, names speakers, puts marks, writes summaries, starts and ends recording, speaks aloud.

**How.** Speech tools come to the agent whose definition carries the `speech` capability; of the built-ins it is the Tagma agent. These are the `list_listenings`, `read_listening`, `read_transcript`, `search_transcripts`, `start_listening`, `end_listening`, `mute_track`, `mark_listening`, `name_speaker`, `describe_listening`, `follow_listening`, `recognize_listening`, `delete_listening`, `speak_text`, `stop_speaking`, `speech_status`, `install_speech_model`, `remove_speech_model` operations.

**Behaviour.**
- `read_transcript` gives the call as text: with no cursor — a header with name, project, time, length, state, and speakers, then lines with moment and speaker, marks, muting, and breaks. A cursor reads new material, a `from`/`to` window reads a segment on the call clock; with waiting the agent waits for a live call's new line.
- Call operations take a project, so one thread's agent reads and labels another project's call.
- What was said on the call reaches the agent as reading material, not instructions.
- Marks, names, summaries, and readings ask the operator for nothing in review mode; recording, muting, assigning a follower, re-recognition, deletion, and speaking aloud ask.

**Limits.** Give pieces, the "handed" mark, and recording-free recognition are the operator's only; the agent has no tools for them. The agent hears no sound, only text. Capture and voice are only on the server machine.
