---
id: 01a14c08-619e-7ae1-af8b-16c7bf51d658
title: "Local Whisper recognizes with no cloud or key: models install and uninstall in speech settings"
ord: 8
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c08-619e-7ae1-af8b-16c5b3ad0acb
sources:
  - kind: dir
    ref: packages/speech-whisper
  - kind: file
    ref: apps/tagma/app/src/lib/features/speech/Installs.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/speech/LocalModels.svelte
  - kind: file
    ref: apps/tagma/server/src/speech/models.ts
---
**Value.** The operator recognizes speech with no cloud and no key — with a local Whisper model on their Mac.

**How.** Settings → Speech, the Local models card: install, cancel installation, delete; download progress comes over the `speech.install.subscribe` feed. The `install_speech_model` and `remove_speech_model` operations are available to agents too. After installation Whisper appears among the recognizers.

**Behaviour.**
- The catalog offers Whisper Large v3 Turbo models; the card shows size and disk footprint, counting partially downloaded data.
- Models live in the data directory and survive a Tagma reinstall. An installed model is checked by size and SHA-256 once, at install time.
- Deleting mid-install interrupts the install first.
- Whisper recognizes in batches over speech segments, not as a stream; so it also fits re-recognizing a recorded call.
- The same engine is the product's only speech detector: without it, turn segmentation on the Tagma side does not happen.
- The first run after installing or updating Tagma compiles Metal shaders, and readiness takes minutes.

**Limits.** The engine is built only for macOS on Apple silicon. Where it is missing — another machine, or a build assembled without the engine tooling — Whisper stays listed as unavailable with a reason, and cloud recognizers keep working.
