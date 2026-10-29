---
id: 01a13c9b-c2eb-7fa3-95cc-fb7db38a8073
title: Sound helper restores output mute dropped by a crashed helper
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13c9d-2ae5-7e58-9cd6-cc210082e080",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a13c7f-b7b8-77fb-b506-75271c89545b
---
Incidental defect of [[1c89545b]]: the sound helper (`packages/audio-darwin/native`, `Mute.swift`) holds the output's initial state only in memory, so a helper that crashed or was killed while muted leaves the Mac's sound muted until switched on by hand.

To do: before muting, the helper writes the output's initial state (device and level/mute) to a file in the data directory the server hands it, and deletes the record once sound is back; a helper at startup, finding the record, returns sound and deletes it.

Done: `--synthetic` helper check or conformance — the record appears on mute, disappears on clean return, and a new helper restores the state from a leftover record.
