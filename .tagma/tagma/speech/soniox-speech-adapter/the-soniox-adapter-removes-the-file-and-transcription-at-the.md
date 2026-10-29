---
id: 01a13818-1464-717e-97d9-c4544215e1f5
title: The Soniox adapter removes the file and transcription at the vendor itself — on failure, parse failure and after the result — but not on interruption after the key issued
ord: 1
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/speech-soniox/src/transcription.ts
---
The Soniox account limits file count and size and transcriptions, and the vendor itself cleans them only after 30 days, so the adapter removes its own work — everywhere except interruption after the key issued, where `resume` continues it.

- **Before the key** the work is nobody's: upload and transcription creation run masked from interruption between steps (interruption works inside a step), and a failed or interrupted creation deletes the uploaded file.
- **After the key**, failure (including an unknown-shape answer and the `error` status) first removes the work, then yields the failure; success removes it with the stream tail, after the consumer took all events — the server records the result before deletion. Interruption removes nothing.
- **409.** The vendor will not let a transcription in processing be deleted: cleanup waits for processing end with the same poll (step 2→10 s, deadline the recording length plus 5 minutes) and deletes again; 404 means "already gone". Cleanup failure only logged: the result already yielded, and the vendor wipes the remainder itself.
- **The key** is JSON `{transcription, file, rate, ms}`, opaque to the caller: `rate` converts transcript milliseconds to the recording format's frames after restart, `ms` sets the poll deadline.
- The file leaves as a multipart stream with a known length upfront: never held whole in memory. Upload goes without a deadline (files up to 10 GiB), other requests wait for an answer no longer than a minute, else counted as transport failure.
- Cleanup removes the file even when the transcription removal failed, and yields the first failure.
