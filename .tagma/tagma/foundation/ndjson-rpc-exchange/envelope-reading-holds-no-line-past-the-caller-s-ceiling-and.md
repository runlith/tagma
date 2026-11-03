---
id: 01a108be-aa1a-738b-9b7d-7d47a891e3f5
title: Envelope reading holds no line past the caller's ceiling, and a worker parses lines longer than 1 MiB
ord: 5
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/ndjson-rpc/src/cutter.ts
  - kind: file
    ref: packages/ndjson-rpc/src/exchange.ts
  - kind: file
    ref: packages/ndjson-rpc/src/offLoop.ts
---
`inbound` reads envelopes from an offset, and the caller sets the line ceiling: holding its source, and a line longer than what is held cannot reliably be read whole — a lagging reader would have lost its start. Framing holds nothing past the ceiling: as soon as an unfinished line outgrows it, the stream fails with `ExchangeOversized` carrying that line's `start`, without waiting for its end, while earlier lines are already delivered. Reading can resume from `start` in `torn` mode, which drops bytes up to the first newline; the same mode is needed after a break, when the source answers from mid-line.

Lines up to 1 MiB parse on the loop; longer ones go to the owner's worker (`offLoop.ts`), which receives the buffer with no copy. The loop pays only for parsing the response's structured clone: on one sample (an 18 MB line, M-series) JSON.parse on the loop took 10.9 ms, while the longest loop pause with the worker was 2.9–7.1 ms. Line order is preserved: short lines after a long one wait for its answer, while lines before it are delivered at once. Lines from one read batch are delivered in groups of at most 1 MiB on the loop, each group as one stream chunk: the consumer takes it in one step (the ACP driver — one lock and one write), and loop parsing per step does not grow with the source batch size. The worker loads by URL next to the module, so in an assembled install `envelope.worker.ts` must sit next to the bundle under its own name, like the other workers from `cut/release.ts`.

The `request` dialogue with a single pending request stands on the same read with a 1 MiB ceiling and writes lines with no `jsonrpc` field, in the JSON-RPC lite dialect of `codex app-server`; `frame` frames for ACP carry `"jsonrpc":"2.0"`, which JSON-RPC 2.0 requires.
