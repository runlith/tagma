---
id: 01a13d38-e6bc-751f-9844-c3a2ab172e64
title: A release trial run upgrades the previous cut with its own button and requires present from the new release copy's helper
ord: 3
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a13c9b-dc32-7bc0-b0f3-020661930775
  - kind: relates
    to: 01a13c7f-b7b8-77fb-b506-75271c89545b
sources:
  - kind: file
    ref: apps/tagma/server/src/mac-release/trial.ts
  - kind: file
    ref: apps/tagma/server/src/mac-release/world.ts
  - kind: symbol
    ref: apps/tagma/server/src/cut/pipeline.ts
    symbol: previousCut
---
A cut's trial run proves the road the release will take to people, not just a start in an empty world. The predecessor's code is issued for good: whether it accepts the new release's manifest, signature and restart shows only through its own button.

- **The predecessor** is the cut that stood in the release directory before the new one, when it is older; every platform's archive is taken from it, matched against its record's sha256. No such one — the release installs itself, with no transition.
- **Every target is tried in its own world:** the build machine's target (on Apple silicon — darwin-arm64) — by transitioning from the same target's predecessor archive over a `file:` feed, the rest — by fresh install. Terminals over pipes and pty open in every world, including a fresh install: without them the check would never touch the execution host, while a server whose host never rose still serves. Everything x64 — bun, the server, the execution host, the sound helper, the Whisper engine — macOS runs under Rosetta; that proves start and operation, but not the Intel processor and its speed.
- **The transition walks the human road:** the predecessor's install-from, its server, a held terminal, `release.feed` = a `file:` feed of the one new release, `install_next {then: restart}`. The predecessor matches the new app's designated requirement against its own release's app, so a release signed with a different Developer ID refuses right here.
- **Done** when `/health` and `current` name the new release, the app copy lies in its directory, the pipes and pty terminals opened before the transition are `running`, the pty record reads from zero with no `gap` and no missed byte up to the last seconds, and `speech_status` answers `present` from the helper launched out of that copy, and the speech detector is `present` — meaning the server has switched on its release's Whisper engine; the engine itself from the installation's `tools/` starts and answers a no-argument call with its own `invocation` error, because the engine never executes the detector's `present`. The helper's hello arrives before any microphone access, so TCC is never asked; the helper opens LaunchServices, so the trial run requires a macOS GUI session.
- **Terminals do not read right after the door:** the new server takes over the execution host only after its own door; terminal calls wait out the takeover, while releases up to and including 0.1.5 answer `terminal-host-unavailable-*` instead of waiting. So the check first waits until the terminal reads again and writes how long it waited and what it was answered, and before the predecessor's held terminals waits until `read_terminals` stops calling the host door-awaiting: a fresh install also goes as an attempt. Any other answer, including a rise refusal, ends the wait, and the terminal start answers with its own refusal.
- **Inside the `.app` only a bundle that passed `codesign --verify --deep --strict` executes:** every file written on this machine carries `com.apple.provenance`, and execution inside a bundle with a mismatched signature is met by Gatekeeper with a "damaged" dialog on the operator's screen.
- **The world ends** with `tagma quit` and LaunchServices forgetting every app under its directory — after the directory is deleted: the predecessor's `update/<v>/Tagma.app` unpack stays registered even after it deleted it (measured on 0.1.1). Otherwise copies from temp directories linger in "Open With".
