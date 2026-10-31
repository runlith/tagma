---
id: 01a151fa-e22a-7b84-aa60-aa7303dc0c6a
title: "An interrupted terminal Claude Code turn ends the run: hook events reach the server, and without them the run never hangs as eternal work"
ord: 22
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
    ref: apps/tagma/server/src/external-harnesses/hooks/dispatch.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/terminal/watch.ts
---
At moss-deer (`01a15127-189c-70bd-9390-aba81de97dda`) the journal is empty over 3 h 42 min: no `UserPromptSubmit`, no `Notification idle_prompt`, no Stop ever reached the server. Analysis showed hook delivery worked: SessionStart arrived at 22:35:08 and bound the session (`observation.binding`). Claude Code never started a turn: there is no session transcript, the envelope stands in the composer, "0 tokens"; the operator pressed a key at 22:35:09, a second after the CLI started. Tagma sees a terminal Claude Code turn end only through them: the Stop hook or `idle_prompt`, after which the transcript tail is read (`external-harnesses/terminal/watch.ts`); on Esc no Stop arrives. So the run hangs `running` since 22:34, heartbeat extends it, and the list shows "thinking · 3h 42m" with a spinner, although the operator cut the turn in the TUI.

To do: establish why this session's events never arrive — launch, session-to-thread binding, hook delivery (cold first delivery in [[e057eae7]]) — and fix at the owner. Decide separately how a run ends when hooks stay silent: now — never.

Done (`a8b4d7dd6c`, `bf877d2310`): the profile declares `ends.tail: 'final'` (Claude Code has it), and a silence over an open turn longer than the window reads the transcript tail: an Esc mid-turn (`[Request interrupted by user`) ends the run `aborted` via the reader. A session that reported start but never started a turn and created no transcript resolves as `untaken` on the current line: its words drop at once, a run of only them is withdrawn. The list line stops showing work with the run end. Not done: a separate "session hooks not arriving" mark in the line — no more eternal work without hooks, but the weakening is unnamed on the line. No live Claude Code screen captured mid-turn: the account of this machine was at the weekly limit, so no screen recognizer added, and the end rests on the transcript.

Proof: a test on the moss-deer scenario — terminal Claude Code, Esc mid-turn: the run ends `aborted` via the reader and the list line stops showing work; a session whose hooks never arrive reads as weakened, not as eternal work.
