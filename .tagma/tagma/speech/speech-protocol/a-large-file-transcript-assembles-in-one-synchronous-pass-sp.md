---
id: 01a13824-dc4e-7ca4-b762-fbdccc7433bf
title: "A large file transcript assembles in one synchronous pass: split assembly and recording to stop holding the event loop"
ord: 11
tags: ["task"]
fields:
  {
    "status": "open"
  }
sources:
  - kind: file
    ref: packages/speech-soniox/src/transcription.ts
  - kind: file
    ref: packages/speech/src/engine/transcription.ts
---
The Soniox adapter delivers the whole transcript in one `Final` (`eventsOf`), and `transcription` runs it through the `Assembler` in a single synchronous step. On a multi-hour recording that is tens of thousands of tokens of JSON parsing and utterance assembly with no yield to the server's event loop.

To do: the adapter delivers the transcript in portions along utterance boundaries (speaker/pause), assembly runs per event; proof is a narrow assembly benchmark on a synthetic 3 h transcript before and after (sample on this machine), with the existing Soniox and speech kit tests green.
