---
id: 01a0ff30-3ce0-7879-8c00-c37c87eac0a0
title: "The Tagma window in speech: setup and verification via server operations, with no sound in the window or in Electron"
ord: 6
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
The Tagma window — browser or Electron — configures speech, verifies it, and shows transcripts, but never touches sound: no `getUserMedia`, no AudioWorklet, no audio packages, no audio section in the desktop bridge. Everything it shows arrives through the `speech` module's operations and feeds ([[cc1f119c|server module]]). That is why the window works the same in Electron and in the browser, and the Electron layer knows nothing about sound.

## Setup and verification surface

Without it the infrastructure cannot be used; it is not a product.
- **Speech provider keys** — next to the console model keys.
- **Default recognizer, language, synthesis voice** — from the models the providers declared, each with availability, reason, and `tuning` handles shaped by the model's schema.
- **Microphone** — from the server machine's device list.
- **Local models** — install with progress, deletion, space taken.
- **Permissions** — microphone and system-sound state and a move into macOS System Settings. The capture itself requests permission on first start; there is no separate form.
- **Verification run** on each track shows the level and distinguishes: no capability; permission unknown or denied; no frames arriving; silence; recognizer not ready; queue growing; provider answered with an error. It also verifies recognition (say a phrase and see text) and synthesis (hear a phrase). The run goes through the `recognize` feed and writes nothing.

The surface only shows facts owned by others (`speech_status`, recognition feeds) and derives none of its own.

## Proof

- Smoke of an installed `Tagma.app`: every item of the verification run on real devices, including denied permission and silence; the same run from a plain browser connected to the same server.
