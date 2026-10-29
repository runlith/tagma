---
id: 01a1270f-ef87-7b70-b5c5-5737a1d459eb
title: Unavailable measurements never interrupt owners' startup and shutdown
ord: 2
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/installation/process/record.ts
  - kind: file
    ref: apps/tagma/server/src/socket/live.ts
---
The right to the data directory serializes restart recording: the candidate buffers phases, and continues the file after taking the directory. A corrupted record and a failure to save it are answered with a separate typed issue; observation never cancels storage opening, feed sending, or owner closing. Accepting a restart and publishing the client window, which promise the saved result, return a typed refusal when saving fails. The window belongs to the client's clock; the server counts the first frame as confirmed by an existing RPC ACK, keeping the moment it was sent, not the moment of the ACK.
