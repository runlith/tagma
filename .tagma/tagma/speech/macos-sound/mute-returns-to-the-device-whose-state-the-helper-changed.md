---
id: 01a106f6-9cbc-7bee-8c16-30531dfa33d4
title: Mute returns to the device whose state the helper changed
ord: 3
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/audio-darwin/native/Sources/AudioCore/Mute.swift
  - kind: file
    ref: packages/audio-darwin/native/Sources/AudioCore/Session.swift
---
The first holder remembers the specific device and its original mute; a default-output change grants no right to rewrite another device's state the helper did not change. EOF, quit and normal exit go through restore. A crash or SIGKILL of the helper itself runs no cleanup, and hardware mute is not a process-scoped resource, so before muting the helper writes a device record, and unmuting deletes it. One record per device, not per process: `<data dir>/audio-mute/<hex uid>.json` with `{device, original, holders: [{pid, started}]}`, all journal operations under `flock` on `audio-mute/lock`. A record holder is a pid plus process start time: a reused pid with a different start does not count as a holder. The first holder across all processes reads the original mute from the device; later ones, including after a crash, take the record's `original`, not the current state. A process releasing its last holder leaves `holders`; sound returns and the record is deleted only when no live holders remain. The next helper at startup drops dead holders and, with none live, returns `original` to the device by uid and deletes the record; records with live holders it leaves alone. Record-based restore always beats a manual mute change between the crash and the start — a decision, not chance. The helper gets the data dir from a `--data` argument; without writing the record it refuses to mute and leaves sound alone. If the device is gone, a restore failure shows only in the helper's stderr, the record stays until the next start, and the new default output's state stays untouched. If the record cannot be deleted after sound returns, release reports a refusal though the sound is already back.
