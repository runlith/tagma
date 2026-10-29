---
id: 01a15f62-6f1b-76cd-ad40-18ea08a1944e
title: Stopping a terminal turn types the CLI's interrupt key and leaves the process alone; the next word waits for the CLI's own confirmation
ord: 4
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a15eeb-6b48-7ca8-9c93-24d8d0f5ca7e
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/sessions/lanes.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/terminal/drafts.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/terminal/interrupts.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/terminal/open.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/terminal/runs.ts
---
Tagma works with a terminal CLI the way a human would work in its TUI. Only acts that free the resource may kill the CLI process: `release` on archive, delete or transport switch ([[e35a759f]]) and terminal stop from the process list. Tagma itself never closes the CLI, not even with its own interrupt key. The one exception is alignment after an act over history (rewind, restore, stop with withdraw): between turns it closes the CLI with the same freeing and seats it on the root matching the journal, typing the composer's unsent text back in.

## Interrupt

The `interrupted` receipt — the host took the interrupt key bytes. This act ends the turn `aborted` in the terminal endings, and the facet takes the `interrupted` mark with the turn snapshot.

The CLI's own confirmation is a later fact. Only background waiting lifts the mark, on one of two witnesses:
- the turn's end in the transcript tail;
- the profile's prompt screen (`promptScreenOf`), in whose composer the returned prompt of Tagma itself does not stand.

The turn-end hook and `idle_prompt` do not lift the mark. Exception — the profile with `ends.interrupt: 'record'`, which is Cursor. Its screen is no witness: with a draft in the composer the "ctrl+c to stop" line is hidden during the turn ([[30124bcd]]). So on Cursor only a record lifts the mark: the turn's end in the transcript or the interrupted turn's Stop hook. The hook writes the witness time into the mark (`heard`), and the same background waiting lifts it.

While there is no mark, the CLI is ready for the next word. Typing words waits for the mark to lift on a record event, not on a timer. The wait survives a read failure and reads again, and `watch` raises it on server start. A profile with neither transcript nor prompt screen has nothing to wait for: the mark lifts at once.

## Which key

The composer reading in the same lane act as the write picks the key. The profile declares a key for an empty composer (`interrupt`) and a sequence for a non-empty one (`composer.drafted`).
- **Claude Code, Codex, Devin.** Esc, and drafts don't move it either. Devin is interrupted only by two Esc presses as separate records ([[4776e930]]), and Tagma types one record per key.
- **Grok.** The first Ctrl-C on a draft only clears the field ([[d3668d90]]). So on a non-empty composer go Ctrl-C, Ctrl-C and Ctrl-Z, which brings the erased draft back. On an empty one — a single Ctrl-C: Ctrl-Z with no erased draft would bring the sent prompt back into the field.
- **Cursor 2026.10.19-6bbf2c4.** On an empty composer — Esc: it interrupts the turn in any phase and does not arm the exit. If the composer holds a draft, history, palette or a follow-up queue, Esc either does not interrupt the turn or goes to the interceptor: the palette closes, history resets, the waiting word is deleted. Then a single Ctrl-C goes. It interrupts the turn, keeps the draft, but arms the exit ([[30124bcd]]). A composer line with no placeholder and no visible text is also a draft, made of spaces: Esc cancels the turn only on an empty field.

The choice is made once, from the composer reading before the first key, and is recorded in the facet before the keys are written (`interrupting`: turn, operation, choice). The record is lifted once the whole sequence is admitted. Repeat and recovery continue the recorded sequence under the same operation number and do not read the screen again. After a lost receipt of the first Ctrl-C the field is already empty, and a new reading would not have typed Ctrl-Z, so the draft would have been lost. An unfinished sequence of another operation of the same turn is finished first.

## Tagma does not close the CLI

On Cursor the second Ctrl-C in the exit window closes the CLI. The window is `exitArm.windowMs`, 2000 ms (`constants.kd` of the shipped 2026.10.19-6bbf2c4 build); probes closed the CLI by repeating after 104 and 1501 ms. The window counts from when the CLI handled the key, not from the PTY write, and handling can lag: in one probe `Cancelled` arrived 881 ms after the second key. So every Tagma Ctrl-C — interrupt or clear — writes `armed` into the facet before the key is written.

The next Ctrl-C goes only when all three hold:
- the CLI confirmed the earlier one (`armed.confirmedAt`): Stop hook, turn end in the transcript, or a lifted mark. A witness counts only if it is later than the press itself: a delayed Stop hook of a turn that ended before the press does not open the window. A Stop hook confirms a press even with no mark, because the turn closed before the stop set it;
- the window since the confirmation passed;
- no "Press Ctrl+C again to exit" banner on screen.

Until then a repeated stop types nothing and answers at once: the turn in Tagma already ended `aborted`, and only the CLI's readiness for the next word is still awaited as fact. `armed` names the pressing operation. A repeat of the same operation after the lane reopened continues its own record instead of hitting the guard. A new stop, while the window after confirmation has not passed, waits for its end. Esc does not arm the exit, and an unconfirmed Ctrl-C does not hold it.

## Returned prompt

Claude Code and Cursor return the interrupted turn's prompt to the composer ([[c00d2207]], [[30124bcd]]). Without clearing, the next word would glue to the old one and reach the agent twice.

Tagma erases from the composer only what it can prove its own. A turn keeps the shape of every text typed into it (`turn.typed`): the digest with whitespace characters removed and the newline count. The shape is written in the same act as the `sending` mark before the write, not at intent — so a steer that held the operator's draft does not become its own. The composer is its own in two cases:
- its text without spaces matches one of the typed ones; the screen wraps lines and shifts them with indentation, so the comparison ignores whitespace characters;
- it is wholly a folded paste `[Pasted text #N +K lines]` with K from the same text. Claude Code counts newlines in K, Cursor counts lines (`returns.counts`).

While the CLI idles with its own composer, the wait types the profile's clear key (`returns.clear`; on both, Ctrl-C: it clears the field whole) and reads the screen again. Idle on Cursor is the turn-end record, on the rest the prompt screen. On Cursor clearing passes the exit guard. The next press goes only once the screen frame changed since the previous press: the host receipt does not prove the CLI handled the key. The press key derives from the frame, so a lost host answer is read under the same record number instead of being typed again. If the screen is unreadable, the turn end in the transcript still confirms the interrupt.

Another's text in the composer — the operator's draft, or a draft next to a returned prompt — is not erased. The mark lifts the same way as on an empty composer, and the word waits.

## Another's text in the composer holds the word

Before every word typing, in the same lane act as the write, the profile's composer is read (`composer.of`): the field text in any phase, without placeholders and hints. On Cursor it also includes the follow-up queue. If the composer is non-empty the word is not typed, or it would glue to another's text. Typing waits until the composer empties, and all that time the transport answers the thread snapshot with the `composer-draft` reason (`TransportRuns.wordsWait`). A turn stop ends the wait. Claude Code, Codex, Cursor, Devin and Grok have readers. Gemini has none: the CLI is not measured ([[c3dd4a91]]).

## Hook events while the mark stands

While the mark stands, no hook event about the turn — start, activity, end — is written to the journal, and it neither opens nor closes the next turn. Tagma words are not typed at this time, so such an event belongs to the interrupted turn or one the CLI started itself. The CLI started a turn after the stop, on an unrevoked word or echo — Tagma interrupts again, by the same key-choice and exit-guard rules.

## A turn with no record in OpenRuns

A turn missing from this server's memory is found by `interrupt` via the run row and thread facet. That happens after a restart before adopt, or in the window between the hook event and the write. If the facet names this turn, the CLI gets the key.

A repeated stop of an already ended turn, while its `interrupted` mark stands, presses again: the CLI has not confirmed the first interrupt yet. The press goes through key choice and the exit guard, so on Cursor with a draft nothing is typed before confirmation. The repeated press reconciles the mark in the same lane act as the write: if the mark was lifted by then, the next turn may already have words, and the key is not typed. Without a mark the answer is `no-turn`: Esc into idle TUI Claude Code would have opened a rewind.

The receipt always follows the key write. Interrupt waits until the session is `running` and this server opened its input lane; after a restart it takes the departed server's lease by expiry. It waits out a turn whose launch is still going until the launch ends: the stop mark wakes launch waits, so words are not typed. If the CLI already received words in argv, the key is typed as soon as the session stands. A CLI that never stood ends the turn with no key. A turn whose CLI process is already dead ends the same way: the host answers the key with `input-ended` or `execution-gone`, and the stop ends the turn `aborted` with no mark instead of refusing.

## One queue per lane

All typing into a session lane — words, question keys, exit, interrupt — goes through one queue (`HarnessLanes.typing`). One act holds the screen check (does a question stand), the `sending` mark, the write and the receipt of words. Without the queue two typings would take one record number, and the second would get `input-conflict`.

## A word mid-turn

The profile declares `steer`:
- `step` — the CLI reads mid-turn words on a step boundary. So on Claude Code and Codex ([[c00d2207]], [[7e38ec20]]). The word is typed into the TUI at once, and one arriving during launch — as soon as the launch ends. This is a separate `unread` record of the same turn with its own id, and receipt and recovery after restart resolve each record separately. Acceptance of words that left in argv at launch lifts only `sending` records. A steer arriving during launch stays `intended` until typed; otherwise it would look typed and wait for the marker until the read deadline.
- `none` — the word waits for the turn's end. So on Cursor, Devin and Grok: their Enter mid-turn queues the word in the CLI as a separate turn ([[30124bcd]], [[4776e930]], [[d3668d90]]). Gemini is not measured ([[c3dd4a91]]).

The declaration stands in the thread row's `capabilities.steer`, and the client draws from it when the word leaves.

## Words on the turn's end

Every turn end releases the words given to it that were never typed. A steer (`steered`) leaves for the core with the `returned` fate and opens the next turn together with other waiting words.

A stop releases the remaining records too:
- typed or sent without a marker — `unconfirmed`;
- an untyped seed — `read` together with writing its words into the turn: words that opened the turn do not open a new turn on stop.

A typed word after a normal turn end waits for the marker: the CLI may have taken it into its own next turn.
