---
id: 01a151fa-e22a-7b84-aa60-aa72093e94ab
title: "Terminal Claude Code gets no empty envelope as the first prompt: a wordless thread raises the CLI with no prompt"
ord: 21
tags: ["task"]
fields:
  {
    "holder": "tagma:01a151fb-6ae2-72a7-8565-b02edaf63602",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a151df-e920-73d7-9b09-09d091976ebe
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/terminal/runs.ts
---
The moss-deer thread (`01a15127-189c-70bd-9390-aba81de97dda`) was born 2026-10-18 at 22:34:39, and in the same millisecond a run opened over an inbox element with empty text. The terminal adapter frames every element with words — `carriesWords` true for everything except compaction — in `<input envelope="…" length="0" digest="e3b0c442…">` (`external-harnesses/terminal/runs.ts#framed`); `print` skips empty text only at a CLI already awaiting input. The first launch left with the empty envelope as the prompt, and Claude Code started working on it. What puts the empty element at a terminal thread's birth is not established.

To do: find the empty-element producer at terminal-thread birth and remove it there — a wordless thread raises the CLI through `ThreadHandle.seat` → `transport.resource.seated`, with no prompt and no run, as a move into the terminal (`TransportResource.seated`); the adapter never frames empty words.

Done (`b22e8598ce`): the producer is `ThreadBirths.create` (`threads/birth/acts.ts`), which on an `''` assignment from the app (`ThreadBirth.launch`) called `begin('')` and opened a run over the empty element. Now an empty assignment raises the CLI through `ThreadHandle.seat` → `transport.resource.seated`, with no prompt and no run; `framed` never frames empty words.

Proof: a test for a wordless terminal-thread birth — no run, the CLI started with no prompt; a birth with words prints them in one envelope.
