---
id: 01a106dc-88c0-73d5-a91f-9bb400315663
title: "An installed model is trusted by receipt: size and SHA-256 are verified once before publishing, not on every use"
ord: 4
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/speech-whisper/src/models/download.ts
  - kind: file
    ref: packages/speech-whisper/src/models/ModelStore.ts
---
Before the atomic rename of the `.partial` directory into the model directory, the on-disk file size and its SHA-256 are verified. The hash is computed while writing from the same bytes `writeAll` wrote, and on resume the already-lying prefix is read once into the same hash; the whole file is re-read only when there was nothing to download. After that, `installed` checks only the receipt and the file size, because re-hashing 0.5–1.6 GB on every request would cost seconds.

- Resume opens the partial file for append (`a`): in Effect rc.110, `File.seek` before `writeAll` on Bun does not move the first write (measured: a write after `seek(10)` landed from zero), and the append flag does not depend on position.
- A 200 response to a `Range` request restarts the file; 206 is accepted only with an exact `content-range`.
- The request lives in the install-flow scope: refusal, extra bytes, or cancellation close the network read.
